import { prisma } from "../../../../../../lib/prisma";
import { json, error, readJson, handler, isInt, HttpError, serializeChat } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth";
import { chatPrefix } from "../../../../../../lib/r2";
import { ownedChat, usageBytes, formatBytes } from "../../../../../../lib/vault";
import { basename, mediaKind, mimeFor } from "../../../../../../lib/chat";

const MAX_PER_REQUEST = 5000;
const KEY_TAIL_RE = /^m\/\d+_[A-Za-z0-9._-]{1,120}$/;

// POST /api/vault/chats/[id]/complete
// Body: { media: [{name, key, size}], final?: boolean, textBytes?: number }
// Media can be registered in several calls (large archives); the call with
// final:true validates the totals and flips the chat to READY.
export const POST = handler(async (request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  if (chat.status !== "UPLOADING") throw new HttpError(409, "This upload is no longer active.");

  const b = await readJson(request);
  if (!b) return error(400, "Invalid request.");
  const media = Array.isArray(b.media) ? b.media : [];
  if (media.length > MAX_PER_REQUEST) return error(400, `At most ${MAX_PER_REQUEST} files per request.`);

  const prefix = chatPrefix(user.id, chat.id);
  const rows = [];
  for (const m of media) {
    const name = typeof m?.name === "string" ? basename(m.name).slice(0, 255) : "";
    const key = typeof m?.key === "string" ? m.key : "";
    if (!name || !key.startsWith(prefix) || !KEY_TAIL_RE.test(key.slice(prefix.length))) {
      return error(400, "Invalid media entry.");
    }
    if (!isInt(m.size, 0, 50 * 1024 ** 3)) return error(400, "Invalid media size.");
    // type info is derived here, never trusted from the client
    rows.push({ chatId: chat.id, name, key, size: BigInt(m.size), mime: mimeFor(name), kind: mediaKind(name) });
  }
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.mediaFile.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
  }

  if (!b.final) {
    await prisma.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
    return json({ ok: true, registered: rows.length });
  }

  if (!isInt(b.textBytes, 0, 2 * 1024 ** 3)) return error(400, "Invalid text size.");
  const agg = await prisma.mediaFile.aggregate({ where: { chatId: chat.id }, _count: true, _sum: { size: true } });
  const totalBytes = Number(agg._sum.size || 0n) + b.textBytes;
  const declared = Number(chat.totalBytes);

  // The quota was checked against the declared size when the upload started.
  if (totalBytes > declared + 1024 * 1024 && user.storageLimitBytes != null) {
    const limit = Number(user.storageLimitBytes);
    const others = (await usageBytes(user.id)) - declared;
    if (others + totalBytes > limit) {
      await prisma.chat.update({ where: { id: chat.id }, data: { status: "FAILED" } });
      return error(413, `Upload is larger than declared and exceeds your storage (${formatBytes(limit)}).`);
    }
  }

  const updated = await prisma.chat.update({
    where: { id: chat.id },
    data: { status: "READY", mediaCount: agg._count, totalBytes: BigInt(totalBytes) },
  });
  return json({ ok: true, chat: serializeChat(updated) });
});
