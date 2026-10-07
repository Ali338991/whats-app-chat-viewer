import { json, handler, serializeAdminChat } from "../../../../../lib/api";
import { requireAdmin } from "../../../../../lib/auth";
import { anyChat, buildChatDetail, hardDeleteChat } from "../../../../../lib/vault";
import { logEvent, logChatOpen } from "../../../../../lib/audit";

// GET /api/admin/chats/[id] — same payload as the user detail endpoint (text URL +
// presigned media URLs), for any user's chat, including soft-deleted ones.
export const GET = handler(async (request, { params }) => {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const chat = await anyChat(id);
  const detail = await buildChatDetail(chat);
  await logChatOpen(request, admin.id, chat, { admin: true });
  const a = serializeAdminChat(chat);
  return json({ ...detail, chat: { ...detail.chat, deletedAt: a.deletedAt, daysSinceDeleted: a.daysSinceDeleted }, owner: a.owner });
});

// DELETE /api/admin/chats/[id] — permanently delete a chat (stored files + row).
export const DELETE = handler(async (request, { params }) => {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const chat = await anyChat(id);
  await hardDeleteChat(chat);
  await logEvent(request, admin.id, {
    type: "ADMIN_CHAT_DELETE", chatId: chat.id, chatName: chat.name, targetUserId: chat.userId,
    meta: { mediaCount: chat.mediaCount, totalBytes: Number(chat.totalBytes), wasDeletedByUser: !!chat.deletedAt },
  });
  return json({ ok: true });
});
