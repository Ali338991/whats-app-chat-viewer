import { prisma } from "../../../../../lib/prisma";
import { json, error, readJson, handler, serializeChat } from "../../../../../lib/api";
import { requireUser } from "../../../../../lib/auth";
import { ownedChat, buildChatDetail } from "../../../../../lib/vault";

// GET /api/vault/chats/[id] — metadata, a presigned URL for the chat text, and
// every media file with a ready-to-use presigned URL (valid 24h). The browser
// fetches everything straight from storage; nothing is proxied through here.
export const GET = handler(async (_request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  return json(await buildChatDetail(chat));
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

// DELETE /api/vault/chats/[id] — remove the chat from the user's vault.
// This is a soft delete: the chat disappears for the user and stops counting
// toward their storage, but the stored data stays until an admin permanently
// deletes it. Works for every status (including failed/cancelled uploads).
export const DELETE = handler(async (_request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  await prisma.chat.update({ where: { id: chat.id }, data: { deletedAt: new Date() } });
  return json({ ok: true });
});
