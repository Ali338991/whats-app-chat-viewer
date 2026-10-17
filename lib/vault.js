// Shared vault logic for route handlers (server only).
import { prisma } from "./prisma";
import { HttpError, serializeChat } from "./api";
import { presignGet, presignGetMany, deletePrefix, deleteObjects, chatPrefix } from "./r2";

export const MAX_SIGN_BATCH = 200;
export const MEDIA_URL_TTL_SEC = 24 * 3600; // presigned media links in the chat detail

// Above this many files the full-URL list could exceed the ~4.5 MB function
// response limit, so links are sent in a compact form (shared query + per-file
// signature) that the client expands into the exact same URLs.
const COMPACT_THRESHOLD = 5000;

export const MAX_MEDIA_DELETE = 500;

// Storage counted against a user's quota: chats that are ready or still
// uploading and NOT removed by the user (soft-deleted chats don't count),
// minus media files the user deleted from those chats.
export async function usageBytes(userId) {
  const activeChat = { userId, deletedAt: null, status: { in: ["READY", "UPLOADING"] } };
  const [agg, removed] = await Promise.all([
    prisma.chat.aggregate({ where: activeChat, _sum: { totalBytes: true } }),
    prisma.mediaFile.aggregate({ where: { deletedAt: { not: null }, chat: activeChat }, _sum: { size: true } }),
  ]);
  return Math.max(0, Number(agg._sum.totalBytes || 0n) - Number(removed._sum.size || 0n));
}

// Per-chat totals of user-deleted media: Map(chatId -> {count, bytes}).
export async function removedMediaByChat(chatIds) {
  if (!chatIds.length) return new Map();
  const rows = await prisma.mediaFile.groupBy({
    by: ["chatId"],
    where: { chatId: { in: chatIds }, deletedAt: { not: null } },
    _count: { _all: true },
    _sum: { size: true },
  });
  return new Map(rows.map((r) => [r.chatId, { count: r._count._all, bytes: Number(r._sum.size || 0n) }]));
}

// Normalize a {mediaIds} request body (unique strings, capped).
export function parseMediaIds(b) {
  const ids = Array.isArray(b?.mediaIds) ? b.mediaIds : null;
  if (!ids || !ids.length) throw new HttpError(400, "No media selected.");
  if (ids.length > MAX_MEDIA_DELETE) throw new HttpError(400, `At most ${MAX_MEDIA_DELETE} files per request.`);
  if (!ids.every((x) => typeof x === "string" && x.length <= 64)) throw new HttpError(400, "Invalid media ids.");
  return [...new Set(ids)];
}

// Permanently delete media rows of one chat (admin): storage first, then rows,
// then chat counters; finally scrub the files from audit events.
export async function hardDeleteMedia(chat, ids) {
  const rows = await prisma.mediaFile.findMany({ where: { chatId: chat.id, id: { in: ids } }, select: { id: true, key: true, size: true } });
  if (!rows.length) return { deleted: 0, bytes: 0 };
  await deleteObjects(rows.map((r) => r.key)); // throws if storage fails → rows stay (retryable)
  const rowIds = rows.map((r) => r.id);
  const bytes = rows.reduce((s, r) => s + Number(r.size), 0);
  await prisma.$transaction([
    prisma.mediaFile.deleteMany({ where: { id: { in: rowIds } } }),
    prisma.chat.update({
      where: { id: chat.id },
      data: { mediaCount: { decrement: rows.length }, totalBytes: { decrement: BigInt(bytes) } },
    }),
  ]);
  try {
    await prisma.auditEvent.updateMany({ where: { mediaId: { in: rowIds } }, data: { mediaId: null, mediaName: null } });
  } catch (err) {
    console.error("[audit] scrub failed", err?.message || err);
  }
  return { deleted: rows.length, bytes };
}

// Load a chat owned by `userId`, or throw 404 (never reveal other users' chats,
// and chats the user removed are gone for them).
export async function ownedChat(userId, chatId, extra = {}) {
  if (typeof chatId !== "string" || chatId.length > 64) throw new HttpError(404, "Chat not found.");
  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId, deletedAt: null }, ...extra });
  if (!chat) throw new HttpError(404, "Chat not found.");
  return chat;
}

// Any chat by id (admin use), including soft-deleted ones.
export async function anyChat(chatId) {
  if (typeof chatId !== "string" || chatId.length > 64) throw new HttpError(404, "Chat not found.");
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  if (!chat) throw new HttpError(404, "Chat not found.");
  return chat;
}

// Mark long-abandoned uploads as failed so they stop counting as "in progress".
export async function expireStaleUploads(userId) {
  await prisma.chat.updateMany({
    where: { userId, deletedAt: null, status: "UPLOADING", updatedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    data: { status: "FAILED" },
  });
}

// Chat detail payload: metadata, a presigned URL for the chat text, and every
// media file with a ready-to-use presigned GET URL (24h).
// `admin`: include media the user deleted (flagged deletedByUser) instead of hiding them.
export async function buildChatDetail(chat, { admin = false } = {}) {
  if (chat.status !== "READY") {
    throw new HttpError(409, chat.status === "UPLOADING" ? "This chat is still uploading." : "This upload did not finish, so there is nothing to show.");
  }
  const all = await prisma.mediaFile.findMany({
    where: { chatId: chat.id },
    select: { id: true, name: true, kind: true, key: true, mime: true, deletedAt: true },
    orderBy: { name: "asc" },
  });
  const media = admin ? all : all.filter((m) => !m.deletedAt);
  const deletedMedia = admin ? [] : all.filter((m) => m.deletedAt).map((m) => ({ name: m.name, kind: m.kind }));
  const flag = (m) => (admin && m.deletedAt ? { deletedByUser: true } : {});

  const expiresAt = new Date(Date.now() + MEDIA_URL_TTL_SEC * 1000).toISOString();
  const [textUrl, urls] = await Promise.all([
    presignGet(chat.textKey, { expiresSec: 3600, contentType: "text/plain; charset=utf-8" }),
    presignGetMany(media.map((m) => ({ key: m.key, contentType: m.mime })), MEDIA_URL_TTL_SEC),
  ]);

  let mediaOut;
  let signing;
  if (media.length > COMPACT_THRESHOLD) {
    // Every URL shares the same date/credential/expiry; only key, type and signature differ.
    const first = new URL(urls[0]);
    const common = new URLSearchParams();
    for (const [k, v] of first.searchParams) {
      if (k !== "X-Amz-Signature" && k !== "response-content-type") common.set(k, v);
    }
    signing = { base: `${first.origin}`, query: common.toString() };
    mediaOut = media.map((m, i) => {
      const u = new URL(urls[i]);
      return { id: m.id, name: m.name, kind: m.kind, mime: m.mime, path: u.pathname, sig: u.searchParams.get("X-Amz-Signature"), ...flag(m) };
    });
  } else {
    mediaOut = media.map((m, i) => ({ id: m.id, name: m.name, kind: m.kind, url: urls[i], ...flag(m) }));
  }
  return { chat: serializeChat(chat), textUrl, expiresAt, media: mediaOut, deletedMedia, ...(signing ? { signing } : {}) };
}

// Permanently delete a chat: every stored object under its folder (plus any
// known keys), then the row (media rows cascade). Admin-only callers.
export async function hardDeleteChat(chat) {
  const media = await prisma.mediaFile.findMany({ where: { chatId: chat.id }, select: { key: true } });
  await deletePrefix(chatPrefix(chat.userId, chat.id), [chat.textKey, ...media.map((m) => m.key)].filter(Boolean));
  await prisma.chat.delete({ where: { id: chat.id } });
}

export function daysSince(date) {
  return date ? Math.floor((Date.now() - new Date(date).getTime()) / 86400000) : null;
}

export function formatBytes(n) {
  if (n == null) return "Unlimited";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
