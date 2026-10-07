import { prisma } from "../../../../lib/prisma";
import { json, handler, serializeAdminChat } from "../../../../lib/api";
import { requireAdmin } from "../../../../lib/auth";

const owner = { select: { id: true, email: true, firstName: true, lastName: true } };

// GET /api/admin/chats?deleted=1 — chats removed by their owners (soft-deleted),
// across all users, oldest deletion first. Without ?deleted=1: every chat, newest first.
export const GET = handler(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const deleted = request.nextUrl.searchParams.get("deleted") === "1";
  const chats = await prisma.chat.findMany({
    where: deleted ? { deletedAt: { not: null } } : {},
    orderBy: deleted ? { deletedAt: "asc" } : { createdAt: "desc" },
    include: { user: owner },
    take: 2000,
  });
  return json({ chats: chats.map(serializeAdminChat) });
});
