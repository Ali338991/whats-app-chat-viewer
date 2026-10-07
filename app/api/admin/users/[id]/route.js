import { prisma } from "../../../../../lib/prisma";
import { json, error, readJson, handler } from "../../../../../lib/api";
import { requireAdmin, hashPassword, setSessionCookie, passwordProblem, cleanName } from "../../../../../lib/auth";
import { serializeAdminUser, parseLimit, userUsage } from "../../../../../lib/adminUsers";
import { deletePrefix, userPrefix } from "../../../../../lib/r2";

async function findUser(id) {
  if (typeof id !== "string" || id.length > 64) return null;
  return prisma.user.findUnique({ where: { id } });
}

// PATCH /api/admin/users/[id]
// { firstName?, lastName?, role?, active?, storageLimitBytes?, password?, unlock? }
export const PATCH = handler(async (request, { params }) => {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const target = await findUser(id);
  if (!target) return error(404, "User not found.");
  const b = await readJson(request);
  if (!b) return error(400, "Invalid request.");
  const self = target.id === admin.id;

  const data = {};
  let revoke = false;

  if (b.firstName !== undefined) {
    const v = cleanName(b.firstName);
    if (!v) return error(400, "First name can't be empty.");
    data.firstName = v;
  }
  if (b.lastName !== undefined) data.lastName = cleanName(b.lastName);
  if (b.role !== undefined) {
    if (b.role !== "ADMIN" && b.role !== "USER") return error(400, "Invalid role.");
    if (self && b.role !== "ADMIN") return error(400, "You can't remove your own admin role.");
    data.role = b.role;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") return error(400, "Invalid value.");
    if (self && !b.active) return error(400, "You can't disable your own account.");
    data.active = b.active;
    if (!b.active && target.active) revoke = true;
    if (b.active) { data.failedLogins = 0; data.lockedUntil = null; }
  }
  if (b.storageLimitBytes !== undefined) {
    const limit = parseLimit(b.storageLimitBytes);
    if (limit.error) return error(400, limit.error);
    data.storageLimitBytes = limit.value;
  }
  if (b.password !== undefined) {
    const pw = passwordProblem(b.password);
    if (pw) return error(400, pw);
    data.passwordHash = await hashPassword(b.password);
    data.failedLogins = 0;
    data.lockedUntil = null;
    revoke = true;
  }
  if (b.unlock) { data.failedLogins = 0; data.lockedUntil = null; }
  if (revoke) data.sessionVersion = { increment: 1 };

  const updated = await prisma.user.update({ where: { id: target.id }, data });
  // Changing your own password revokes your old sessions — keep this one signed in.
  if (self && revoke) await setSessionCookie(updated);

  return json({ user: serializeAdminUser(updated, await userUsage(target.id)) });
});

// GET /api/admin/users/[id] — one user with usage (active vs removed bytes).
export const GET = handler(async (_request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const target = await findUser(id);
  if (!target) return error(404, "User not found.");
  return json({ user: serializeAdminUser(target, await userUsage(target.id)) });
});

// DELETE /api/admin/users/[id] — delete all of the user's stored files
// (including chats they removed), then the user.
export const DELETE = handler(async (_request, { params }) => {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;
  const { id } = await params;
  const target = await findUser(id);
  if (!target) return error(404, "User not found.");
  if (target.id === admin.id) return error(400, "You can't delete your own account.");

  const chatCount = await prisma.chat.count({ where: { userId: target.id } });
  if (chatCount > 0) {
    const [chats, media] = await Promise.all([
      prisma.chat.findMany({ where: { userId: target.id }, select: { textKey: true } }),
      prisma.mediaFile.findMany({ where: { chat: { userId: target.id } }, select: { key: true } }),
    ]);
    await deletePrefix(userPrefix(target.id), [...chats.map((c) => c.textKey), ...media.map((m) => m.key)]);
  }
  await prisma.user.delete({ where: { id: target.id } });
  return json({ ok: true });
});
