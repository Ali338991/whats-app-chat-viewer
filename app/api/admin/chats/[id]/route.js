import { json, handler, serializeAdminChat } from "../../../../../lib/api";
import { requireAdmin } from "../../../../../lib/auth";
import { anyChat, buildChatDetail, hardDeleteChat } from "../../../../../lib/vault";

// GET /api/admin/chats/[id] — same payload as the user detail endpoint (text URL +
// presigned media URLs), for any user's chat, including soft-deleted ones.
export const GET = handler(async (_request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const chat = await anyChat(id);
  const detail = await buildChatDetail(chat);
  const a = serializeAdminChat(chat);
  return json({ ...detail, chat: { ...detail.chat, deletedAt: a.deletedAt, daysSinceDeleted: a.daysSinceDeleted }, owner: a.owner });
});

// DELETE /api/admin/chats/[id] — permanently delete a chat (stored files + row).
export const DELETE = handler(async (_request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const chat = await anyChat(id);
  await hardDeleteChat(chat);
  return json({ ok: true });
});
