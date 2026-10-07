import { prisma } from "../../../../../lib/prisma";
import { json, error, readJson, handler, serializeChat, HttpError } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth";
import { presignGet, presignGetMany, deletePrefix, chatPrefix } from "../../../../../lib/r2";
import { ownedChat, MEDIA_URL_TTL_SEC } from "../../../../../lib/vault";

// Above this many files the full-URL list could exceed the ~4.5 MB function
// response limit, so links are sent in a compact form (shared query + per-file
// signature) that the client expands into the exact same URLs.
const COMPACT_THRESHOLD = 5000;

// GET /api/vault/chats/[id] — metadata, a presigned URL for the chat text, and
// every media file with a ready-to-use presigned URL (valid 24h). The browser
// fetches everything straight from R2; nothing is proxied through here.
export const GET = handler(async (_request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  if (chat.status !== "READY") {
    throw new HttpError(409, chat.status === "UPLOADING" ? "This chat is still uploading." : "This upload did not finish. Delete it and upload the chat again.");
  }

  const media = await prisma.mediaFile.findMany({
    where: { chatId: chat.id },
    select: { id: true, name: true, kind: true, key: true, mime: true },
    orderBy: { name: "asc" },
  });

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
      return { id: m.id, name: m.name, kind: m.kind, mime: m.mime, path: u.pathname, sig: u.searchParams.get("X-Amz-Signature") };
    });
  } else {
    mediaOut = media.map((m, i) => ({ id: m.id, name: m.name, kind: m.kind, url: urls[i] }));
  }

  return json({ chat: serializeChat(chat), textUrl, expiresAt, media: mediaOut, ...(signing ? { signing } : {}) });
});

// PATCH /api/vault/chats/[id] — rename, or remember which sender is "me".
export const PATCH = handler(async (request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  const b = await readJson(request);
  if (!b) return error(400, "Invalid request.");
  const data = {};
  if (b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
    if (!name) return error(400, "Name can't be empty.");
    data.name = name;
  }
  if (b.me !== undefined) {
    if (b.me !== null && typeof b.me !== "string") return error(400, "Invalid value.");
    data.me = b.me ? b.me.slice(0, 200) : null;
  }
  if (!Object.keys(data).length) return json({ chat: serializeChat(chat) });
  const updated = await prisma.chat.update({ where: { id: chat.id }, data });
  return json({ chat: serializeChat(updated) });
});

// DELETE /api/vault/chats/[id] — delete every stored object, then the row.
export const DELETE = handler(async (_request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  const media = await prisma.mediaFile.findMany({ where: { chatId: chat.id }, select: { key: true } });
  await deletePrefix(chatPrefix(user.id, chat.id), [chat.textKey, ...media.map((m) => m.key)]);
  await prisma.chat.delete({ where: { id: chat.id } });
  return json({ ok: true });
});
