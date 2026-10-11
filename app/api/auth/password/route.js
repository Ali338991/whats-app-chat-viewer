import { prisma } from "../../../../lib/prisma";
import { json, error, readJson, handler } from "../../../../lib/api";
import {
  requireUser, verifyPassword, hashPassword, passwordProblem, setSessionCookie,
  MAX_FAILED_LOGINS, LOCK_MINUTES,
} from "../../../../lib/auth";
import { logEvent } from "../../../../lib/audit";

// POST /api/auth/password { currentPassword, newPassword }
// The signed-in user changes their own password. Wrong current passwords count
// toward the same lockout as sign-in, so a stolen session can't be used to
// brute-force it. On success every other session is signed out; this one stays.
export const POST = handler(async (request) => {
  const { user, response } = await requireUser();
  if (response) return response;
  const b = await readJson(request);
  const current = typeof b?.currentPassword === "string" ? b.currentPassword : "";
  const next = typeof b?.newPassword === "string" ? b.newPassword : "";
  if (!current || !next) return error(400, "Enter your current and new password.");

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return error(429, "Too many wrong attempts. Try again in a few minutes.");
  }

  if (!(await verifyPassword(current, user.passwordHash))) {
    const updated = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
    if (updated.failedLogins >= MAX_FAILED_LOGINS) {
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } });
      return error(429, `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`);
    }
    return error(400, "Your current password is incorrect.");
  }

  const problem = passwordProblem(next);
  if (problem) return error(400, problem);
  if (await verifyPassword(next, user.passwordHash)) return error(400, "Choose a password different from your current one.");

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } },
  });
  await setSessionCookie(updated); // keep this device signed in
  await logEvent(request, user.id, { type: "PASSWORD_CHANGE" });
  return json({ ok: true });
});
