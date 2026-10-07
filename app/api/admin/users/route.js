import { prisma } from "../../../../lib/prisma";
import { json, error, readJson, handler } from "../../../../lib/api";
import { requireAdmin, hashPassword, normalizeEmail, validEmail, passwordProblem, cleanName } from "../../../../lib/auth";
import { listUsersWithUsage, serializeAdminUser, parseLimit } from "../../../../lib/adminUsers";

// GET /api/admin/users — every user with chat count and storage used.
export const GET = handler(async () => {
  const { response } = await requireAdmin();
  if (response) return response;
  return json({ users: await listUsersWithUsage() });
});

// POST /api/admin/users — create a user directly (bypasses SIGNUPS_ENABLED).
export const POST = handler(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const b = await readJson(request);
  if (!b) return error(400, "Invalid request.");

  const email = normalizeEmail(b.email);
  const firstName = cleanName(b.firstName);
  const lastName = cleanName(b.lastName);
  if (!firstName) return error(400, "First name is required.");
  if (!validEmail(email)) return error(400, "Enter a valid email address.");
  const pw = passwordProblem(b.password);
  if (pw) return error(400, pw);
  const role = b.role === "ADMIN" ? "ADMIN" : "USER";
  const limit = parseLimit(b.storageLimitBytes);
  if (limit.error) return error(400, limit.error);

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return error(409, "That email is already registered.");

  const user = await prisma.user.create({
    data: { email, firstName, lastName, passwordHash: await hashPassword(b.password), role, storageLimitBytes: limit.value },
  });
  return json({ user: serializeAdminUser(user) }, { status: 201 });
});
