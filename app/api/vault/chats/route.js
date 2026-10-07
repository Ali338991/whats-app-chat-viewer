import { prisma } from "../../../../lib/prisma";
import { json, error, readJson, handler, isInt, optString, serializeChat } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth";
import { presignPut, textKeyFor, r2Configured } from "../../../../lib/r2";
import { usageBytes, expireStaleUploads, formatBytes } from "../../../../lib/vault";

// GET /api/vault/chats — the signed-in user's chats (newest first) + storage usage.
export const GET = handler(async () => {
  const { user, response } = await requireUser();
  if (response) return response;
  await expireStaleUploads(user.id);
  const [chats, used] = await Promise.all([
    prisma.chat.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    usageBytes(user.id),
  ]);
  return json({
    chats: chats.map(serializeChat),
    usage: { usedBytes: used, limitBytes: user.storageLimitBytes == null ? null : Number(user.storageLimitBytes) },
  });
});

// POST /api/vault/chats — start an upload: quota check, create the chat (UPLOADING).
export const POST = handler(async (request) => {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!r2Configured()) return error(503, "Cloud storage is not configured on the server.");
  const b = await readJson(request);
  if (!b) return error(400, "Invalid request.");

  const name = typeof b.name === "string" ? b.name.trim().slice(0, 200) : "";
  const firstDate = optString(b.firstDate, 40);
  const lastDate = optString(b.lastDate, 40);
  const preview = optString(b.preview, 200);
  if (!name) return error(400, "Chat name is required.");
  if (!isInt(b.messageCount, 1, 50_000_000)) return error(400, "Invalid message count.");
  if (!isInt(b.mediaCount, 0, 1_000_000)) return error(400, "Invalid media count.");
  if (!isInt(b.totalBytes, 0, 1024 ** 4)) return error(400, "Invalid size.");
  if (firstDate === undefined || lastDate === undefined || preview === undefined) return error(400, "Invalid metadata.");

  if (user.storageLimitBytes != null) {
    const limit = Number(user.storageLimitBytes);
    const used = await usageBytes(user.id);
    if (used + b.totalBytes > limit) {
      return error(
        413,
        `Not enough storage: this chat needs ${formatBytes(b.totalBytes)} but you have ${formatBytes(Math.max(0, limit - used))} left of ${formatBytes(limit)}.`
      );
    }
  }

  const created = await prisma.chat.create({
    data: {
      userId: user.id,
      name,
      status: "UPLOADING",
      textKey: "",
      messageCount: b.messageCount,
      firstDate,
      lastDate,
      preview,
      mediaCount: b.mediaCount,
      totalBytes: BigInt(b.totalBytes),
    },
  });
  const textKey = textKeyFor(user.id, created.id);
  const chat = await prisma.chat.update({ where: { id: created.id }, data: { textKey } });
  const textUploadUrl = await presignPut(textKey);
  return json({ id: chat.id, chat: serializeChat(chat), textUploadUrl }, { status: 201 });
});
