import { prisma } from "../../../../lib/prisma";
import { json, error, readJson, handler } from "../../../../lib/api";
import { logEvent } from "../../../../lib/audit";
import {
  authConfigured, verifyPassword, normalizeEmail, setSessionCookie,
  publicUser, MAX_FAILED_LOGINS, LOCK_MINUTES, DUMMY_HASH,
} from "../../../../lib/auth";

const INVALID = "Invalid email or password.";

function lockedMessage(until) {
  const mins = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `Too many failed attempts. For your security this account is locked — try again in ${mins} minute${mins > 1 ? "s" : ""}.`;
}

export const POST = handler(async (request) => {
  if (!authConfigured()) return error(500, "Sign-in is not configured on the server (AUTH_SECRET missing).");
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || password.length > 200) return error(400, "Enter your email and password.");

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await verifyPassword(password, DUMMY_HASH); // equalize timing
    return error(401, INVALID);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logEvent(request, user.id, { type: "LOGIN_FAILED", meta: { whileLocked: true } });
    return error(429, lockedMessage(user.lockedUntil), { lockedUntil: user.lockedUntil });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: { increment: 1 } },
    });
    if (updated.failedLogins >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil, failedLogins: 0 } });
      await logEvent(request, user.id, { type: "LOGIN_FAILED", meta: { locked: true } });
      return error(429, lockedMessage(lockedUntil), { lockedUntil });
    }
    await logEvent(request, user.id, { type: "LOGIN_FAILED" });
    return error(401, INVALID);
  }
  if (!user.active) {
    await logEvent(request, user.id, { type: "LOGIN_FAILED", meta: { disabled: true } });
    return error(403, "This account has been disabled. Please contact support.");
  }

  user = await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await setSessionCookie(user);
  await logEvent(request, user.id, { type: "LOGIN" });
  return json({ user: publicUser(user) });
});
