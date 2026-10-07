import { prisma } from "../../../../../../lib/prisma";
import { json, error, handler, serializeAdminChat } from "../../../../../../lib/api";
import { requireAdmin } from "../../../../../../lib/auth";

// GET /api/admin/users/[id]/chats — every chat of a user, including ones the
// user removed (soft-deleted), newest first.
export const GET = handler(async (_request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  if (typeof id !== "string" || id.length > 64) return error(404, "User not found.");
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return error(404, "User not found.");
  const chats = await prisma.chat.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" } });
  return json({ chats: chats.map(serializeAdminChat) });
});
