import { prisma } from "../../../../lib/prisma";
import { json, error, readJson, handler } from "../../../../lib/api";
import { logEvent } from "../../../../lib/audit";
import {
  authConfigured, signupsEnabled, normalizeEmail, validEmail, passwordProblem, cleanName,
  hashPassword, setSessionCookie, publicUser, defaultStorageLimitBytes,
} from "../../../../lib/auth";

const TAKEN = "That email is already registered. Try signing in instead.";

// POST /api/auth/signup — create a USER account and sign it in.
export const POST = handler(async (request) => {
  if (!signupsEnabled()) return error(403, "Sign-ups are closed right now.");
  if (!authConfigured()) return error(500, "Sign-up is not configured on the server (AUTH_SECRET missing).");

  const b = await readJson(request);
  if (!b) return error(400, "Invalid request.");
  const firstName = cleanName(b.firstName);
  const lastName = cleanName(b.lastName);
  const email = normalizeEmail(b.email);
  const fields = {};
  if (!firstName) fields.firstName = "Enter your first name.";
  if (!lastName) fields.lastName = "Enter your last name.";
  if (!validEmail(email)) fields.email = "Enter a valid email address.";
  const pwProblem = passwordProblem(b.password);
  if (pwProblem) fields.password = pwProblem;
  if (b.confirmPassword !== undefined && b.confirmPassword !== b.password) fields.confirmPassword = "Passwords don't match.";
  if (Object.keys(fields).length) return error(400, Object.values(fields)[0], { fields });

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return error(409, TAKEN, { fields: { email: TAKEN } });
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash: await hashPassword(b.password),
        role: "USER",
        storageLimitBytes: defaultStorageLimitBytes(),
        lastLoginAt: new Date(),
      },
    });
  } catch (err) {
    if (err?.code === "P2002") return error(409, TAKEN, { fields: { email: TAKEN } }); // raced unique constraint
    throw err;
  }
  await setSessionCookie(user);
  await logEvent(request, user.id, { type: "SIGNUP" });
  return json({ user: publicUser(user) }, { status: 201 });
});
