import { prisma } from "../../../../../../lib/prisma";
import { json, handler, serializeAdminChat } from "../../../../../../lib/api";
import { requireAdmin } from "../../../../../../lib/auth";
import { anyChat } from "../../../../../../lib/vault";

// POST /api/admin/chats/[id]/restore — undo a user's removal (soft delete).
export const POST = handler(async (_request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const chat = await anyChat(id);
  const updated = await prisma.chat.update({
    where: { id: chat.id },
    data: { deletedAt: null },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  return json({ chat: serializeAdminChat(updated) });
});
