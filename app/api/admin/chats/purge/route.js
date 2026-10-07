import { prisma } from "../../../../../lib/prisma";
import { json, error, readJson, handler, isInt } from "../../../../../lib/api";
import { requireAdmin } from "../../../../../lib/auth";
import { hardDeleteChat } from "../../../../../lib/vault";
import { logEvent } from "../../../../../lib/audit";

const PER_CALL = 10; // keep each call well inside serverless time limits

// POST /api/admin/chats/purge {olderThanDays} — permanently delete soft-deleted
// chats removed more than N days ago, a few per call. Returns {deleted, remaining};
// the admin UI calls again until remaining is 0. Admin-triggered only (no cron).
export const POST = handler(async (request) => {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;
  const b = await readJson(request);
  const days = b?.olderThanDays ?? 30;
  if (!isInt(days, 0, 36500)) return error(400, "olderThanDays must be a whole number of days.");
  const cutoff = new Date(Date.now() - days * 86400000);
  const where = { deletedAt: { not: null, lt: cutoff } };

  const batch = await prisma.chat.findMany({ where, orderBy: { deletedAt: "asc" }, take: PER_CALL });
  let deleted = 0;
  const failed = [];
  const purged = [];
  for (const chat of batch) {
    try {
      await hardDeleteChat(chat);
      deleted++;
      purged.push({ id: chat.id, name: chat.name, userId: chat.userId });
    } catch (err) {
      console.error("purge failed for chat", chat.id, err);
      failed.push(chat.id);
    }
  }
  if (batch.length && !deleted) return error(502, "Couldn't delete stored files. Please try again.", { failed });
  if (deleted) await logEvent(request, admin.id, { type: "ADMIN_PURGE", meta: { count: deleted, days, chats: purged } });
  const remaining = await prisma.chat.count({ where });
  return json({ deleted, remaining, failed });
});
