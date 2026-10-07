import { prisma } from "../../../../../../lib/prisma";
import { json, handler, serializeAdminChat } from "../../../../../../lib/api";
import { requireAdmin } from "../../../../../../lib/auth";
import { anyChat } from "../../../../../../lib/vault";
import { logEvent } from "../../../../../../lib/audit";

// POST /api/admin/chats/[id]/restore — undo a user's removal (soft delete).
export const POST = handler(async (request, { params }) => {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const chat = await anyChat(id);
  const updated = await prisma.chat.update({
    where: { id: chat.id },
    data: { deletedAt: null },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  await logEvent(request, admin.id, { type: "ADMIN_CHAT_RESTORE", chatId: chat.id, chatName: chat.name, targetUserId: chat.userId });
  return json({ chat: serializeAdminChat(updated) });
});
