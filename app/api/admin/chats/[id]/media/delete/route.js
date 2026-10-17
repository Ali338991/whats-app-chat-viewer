import { json, readJson, handler } from "../../../../../../../lib/api";
import { requireAdmin } from "../../../../../../../lib/auth";
import { anyChat, parseMediaIds, hardDeleteMedia } from "../../../../../../../lib/vault";
import { logEvent } from "../../../../../../../lib/audit";

// POST /api/admin/chats/[id]/media/delete {mediaIds} — permanently delete files
// from any chat (incl. removed chats and files the user already deleted):
// storage objects first, then the rows; chat counters are decremented and the
// files' ids/names are scrubbed from the audit log. If storage fails nothing
// is removed from the DB, so the request can be retried.
export const POST = handler(async (request, { params }) => {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const chat = await anyChat(id);
  const ids = parseMediaIds(await readJson(request));
  const r = await hardDeleteMedia(chat, ids);
  if (r.deleted) {
    // count only — no file names or ids, so no trace of the deleted media remains
    await logEvent(request, admin.id, { type: "ADMIN_MEDIA_DELETE", chatId: chat.id, chatName: chat.name, targetUserId: chat.userId, meta: { count: r.deleted } });
  }
  return json({ deleted: r.deleted });
});
