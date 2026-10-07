import crypto from "node:crypto";
import { prisma } from "../../../../lib/prisma";
import { json, error, readJson, handler } from "../../../../lib/api";
import {
  authConfigured, verifyPassword, hashPassword, normalizeEmail, validEmail, setSessionCookie,
  publicUser, MAX_FAILED_LOGINS, LOCK_MINUTES, DUMMY_HASH,
} from "../../../../lib/auth";

const INVALID = "Invalid email or password.";

function lockedMessage(until) {
  const mins = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `Too many failed attempts. For your security this account is locked — try again in ${mins} minute${mins > 1 ? "s" : ""}.`;
}

// Constant-time string comparison (hash first so lengths match).
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const POST = handler(async (request) => {
  if (!authConfigured()) return error(500, "Sign-in is not configured on the server (AUTH_SECRET missing).");
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || password.length > 200) return error(400, "Enter your email and password.");

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // First-run bootstrap: with no users at all, ADMIN_EMAIL / ADMIN_PASSWORD create the first admin.
    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const adminPass = process.env.ADMIN_PASSWORD || "";
    if (adminEmail && adminPass && (await prisma.user.count()) === 0) {
      const match = safeEqual(email, adminEmail) & safeEqual(password, adminPass);
      if (match) {
        if (!validEmail(adminEmail)) return error(500, "ADMIN_EMAIL is not a valid email address.");
        try {
          user = await prisma.user.create({
            data: {
              email: adminEmail,
              passwordHash: await hashPassword(adminPass),
              firstName: "Admin",
              lastName: "",
              role: "ADMIN",
              lastLoginAt: new Date(),
            },
          });
        } catch {
          return error(409, "Setup is already complete — please sign in again.");
        }
        await setSessionCookie(user);
        return json({ user: publicUser(user), bootstrapped: true });
      }
    }
    await verifyPassword(password, DUMMY_HASH); // equalize timing
    return error(401, INVALID);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
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
      return error(429, lockedMessage(lockedUntil), { lockedUntil });
    }
    return error(401, INVALID);
  }
  if (!user.active) return error(403, "This account has been disabled. Please contact support.");

  user = await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await setSessionCookie(user);
  return json({ user: publicUser(user) });
});
