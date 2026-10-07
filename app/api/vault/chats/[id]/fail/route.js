import { prisma } from "../../../../../../lib/prisma";
import { json, handler } from "../../../../../../lib/api";
import { requireUser } from "../../../../../../lib/auth";
import { ownedChat } from "../../../../../../lib/vault";

// POST /api/vault/chats/[id]/fail — the browser reports that an upload failed.
// The chat stays in the list as FAILED so the user can delete it.
export const POST = handler(async (_request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  if (chat.status === "UPLOADING") {
    await prisma.chat.update({ where: { id: chat.id }, data: { status: "FAILED" } });
  }
  return json({ ok: true });
});
