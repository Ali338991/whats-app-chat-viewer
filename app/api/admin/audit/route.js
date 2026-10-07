import { prisma } from "../../../../lib/prisma";
import { json, error, handler } from "../../../../lib/api";
import { requireAdmin } from "../../../../lib/auth";
import { ALL_TYPES, pageEvents, cursorParam } from "../../../../lib/audit";

const actor = { select: { id: true, email: true, firstName: true, lastName: true } };

// GET /api/admin/audit?type=&userId=&cursor= — global feed of every event
// (including admin actions), newest first, with actor and target user.
// `userId` matches events where the user is the actor OR the target.
export const GET = handler(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const sp = request.nextUrl.searchParams;
  const type = sp.get("type");
  const userId = sp.get("userId");
  if (type && type !== "ADMIN" && !ALL_TYPES.includes(type)) return error(400, "Unknown event type.");
  const where = {
    ...(type === "ADMIN" ? { type: { startsWith: "ADMIN_" } } : type ? { type } : {}),
    ...(userId ? { OR: [{ userId: userId.slice(0, 64) }, { targetUserId: userId.slice(0, 64) }] } : {}),
  };
  const page = await pageEvents(where, cursorParam(request), { user: actor });

  // Resolve target users (no FK, the user may have been deleted).
  const ids = [...new Set(page.events.map((e) => e.targetUserId).filter(Boolean))];
  const targets = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, firstName: true, lastName: true } })
    : [];
  const byId = new Map(targets.map((t) => [t.id, t]));
  for (const e of page.events) {
    if (e.targetUserId) e.target = byId.get(e.targetUserId) || { id: e.targetUserId, email: e.meta?.email || null, deleted: true };
  }
  return json(page);
});
