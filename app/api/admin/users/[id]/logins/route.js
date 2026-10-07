import { prisma } from "../../../../../../lib/prisma";
import { json, error, handler } from "../../../../../../lib/api";
import { requireAdmin } from "../../../../../../lib/auth";
import { AUTH_TYPES, pageEvents, cursorParam, parseUserAgent } from "../../../../../../lib/audit";

// GET /api/admin/users/[id]/logins?cursor= — sign-in history (newest first, 50/page) + summary.
export const GET = handler(async (request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  if (typeof id !== "string" || id.length > 64) return error(404, "User not found.");
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, createdAt: true } });
  if (!user) return error(404, "User not found.");

  const cursor = cursorParam(request);
  const page = await pageEvents({ userId: id, type: { in: AUTH_TYPES } }, cursor);

  let summary = null;
  if (!cursor) {
    const since30 = new Date(Date.now() - 30 * 86400000);
    const [logins, first, last, failed30, agents] = await Promise.all([
      prisma.auditEvent.count({ where: { userId: id, type: { in: ["LOGIN", "SIGNUP"] } } }),
      prisma.auditEvent.findFirst({ where: { userId: id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.auditEvent.findFirst({ where: { userId: id, type: { in: ["LOGIN", "SIGNUP"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, ip: true, city: true, country: true } }),
      prisma.auditEvent.count({ where: { userId: id, type: "LOGIN_FAILED", createdAt: { gte: since30 } } }),
      prisma.auditEvent.groupBy({ by: ["userAgent"], where: { userId: id, type: { in: ["LOGIN", "SIGNUP"] } } }),
    ]);
    const devices = new Set(agents.map((a) => parseUserAgent(a.userAgent).label));
    summary = {
      totalLogins: logins,
      firstSeen: first?.createdAt || user.createdAt,
      lastLogin: last?.createdAt || null,
      lastLocation: last ? { ip: last.ip, city: last.city, country: last.country } : null,
      failedLast30Days: failed30,
      distinctDevices: devices.size,
      devices: [...devices],
    };
  }
  return json({ ...page, summary });
});
