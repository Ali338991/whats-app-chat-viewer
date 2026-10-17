import { prisma } from "../../../../../../../lib/prisma";
import { json, readJson, handler } from "../../../../../../../lib/api";
import { requireUser } from "../../../../../../../lib/auth";
import { ownedChat, parseMediaIds } from "../../../../../../../lib/vault";
import { logEvent } from "../../../../../../../lib/audit";

// POST /api/vault/chats/[id]/media/delete {mediaIds} — the user deletes files
// from their chat. Soft delete: the files disappear for the user and stop
// counting toward their storage; ids from other chats are ignored.
export const POST = handler(async (request, { params }) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const chat = await ownedChat(user.id, id);
  const ids = parseMediaIds(await readJson(request));
  const r = await prisma.mediaFile.updateMany({
    where: { chatId: chat.id, id: { in: ids }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (r.count) await logEvent(request, user.id, { type: "MEDIA_DELETE", chatId: chat.id, chatName: chat.name, meta: { count: r.count } });
  return json({ deleted: r.count });
});
