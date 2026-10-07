// Shared vault logic for route handlers (server only).
import { prisma } from "./prisma";
import { HttpError } from "./api";

export const MAX_SIGN_BATCH = 200;
export const MEDIA_URL_TTL_SEC = 24 * 3600; // presigned media links in the chat detail

// Storage counted against a user's quota: chats that are ready or still uploading.
export async function usageBytes(userId) {
  const agg = await prisma.chat.aggregate({
    where: { userId, status: { in: ["READY", "UPLOADING"] } },
    _sum: { totalBytes: true },
  });
  return Number(agg._sum.totalBytes || 0n);
}

// Load a chat owned by `userId`, or throw 404 (never reveal other users' chats).
export async function ownedChat(userId, chatId, extra = {}) {
  if (typeof chatId !== "string" || chatId.length > 64) throw new HttpError(404, "Chat not found.");
  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId }, ...extra });
  if (!chat) throw new HttpError(404, "Chat not found.");
  return chat;
}

// Mark long-abandoned uploads as failed so they stop counting as "in progress".
export async function expireStaleUploads(userId) {
  await prisma.chat.updateMany({
    where: { userId, status: "UPLOADING", updatedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    data: { status: "FAILED" },
  });
}

export function formatBytes(n) {
  if (n == null) return "Unlimited";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
