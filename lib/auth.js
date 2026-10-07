// Authentication: email + password, signed JWT session cookie.
// Server-only. Every route handler / server component checks auth itself
// (no proxy/middleware), via getCurrentUser() / requireUser() / requireAdmin().
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { error } from "./api";

export const SESSION_COOKIE = "ks_session";

// How long a sign-in lasts before the user must log in again: SESSION_HOURS
// (default 24). Fixed from the moment of sign-in — activity doesn't extend it.
export function sessionSeconds() {
  const hours = Number(process.env.SESSION_HOURS);
  return Math.round((Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600);
}
const BCRYPT_COST = 12;

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

// A real bcrypt hash of a random string: compared against when the email
// doesn't exist, so response timing doesn't reveal which IDs are valid.
export const DUMMY_HASH = "$2b$12$7I1clbNr445Y7NWKM9KOMe9VN08SuFtQ/sQM8BjPLC11LVYyMm71K";

function secretKey() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) return null;
  return new TextEncoder().encode(s);
}

export function authConfigured() {
  return !!secretKey();
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash || DUMMY_HASH);
}

export function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function validEmail(e) {
  return typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e);
}

// 8–72 characters; bcrypt only uses the first 72 bytes, so cap by bytes too.
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 72 || new TextEncoder().encode(pw).length > 72) return "Password must be at most 72 characters.";
  return null;
}

export function cleanName(v, max = 60) {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

// Storage quota for new self-service accounts: DEFAULT_STORAGE_LIMIT_GB (default 5; 0 = unlimited).
export function defaultStorageLimitBytes() {
  const raw = process.env.DEFAULT_STORAGE_LIMIT_GB;
  const gb = raw == null || raw.trim() === "" ? 5 : Number(raw);
  if (!Number.isFinite(gb) || gb < 0) return BigInt(5 * 1024 ** 3);
  if (gb === 0) return null;
  return BigInt(Math.round(gb * 1024 ** 3));
}

export function signupsEnabled() {
  return String(process.env.SIGNUPS_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

export async function createSessionToken(user) {
  const key = secretKey();
  if (!key) throw new Error("AUTH_SECRET is not set (min 16 characters)");
  return new SignJWT({ uid: user.id, sv: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionSeconds()}s`)
    .sign(key);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionSeconds(),
  };
}

export async function setSessionCookie(user) {
  const token = await createSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

// Returns the signed-in user (fresh from the DB) or null. A session is only
// valid while the user exists, is active, and its sessionVersion matches —
// so a password reset or disabling the account revokes every session.
export async function getCurrentUser() {
  // Read cookies first: this marks every caller as dynamic (never prerendered).
  const store = await cookies();
  const key = secretKey();
  if (!key) return null;
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let payload;
  try {
    // maxTokenAge also caps tokens issued under an older, longer setting.
    ({ payload } = await jwtVerify(token, key, { algorithms: ["HS256"], maxTokenAge: `${sessionSeconds()}s` }));
  } catch {
    return null;
  }
  if (typeof payload.uid !== "string") return null;
  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || !user.active || user.sessionVersion !== payload.sv) return null;
  return user;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    onboarded: !!user.onboardedAt,
  };
}

// For route handlers: `const { user, response } = await requireUser(); if (response) return response;`
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return { response: error(401, "Please sign in.") };
  return { user };
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { response: error(401, "Please sign in.") };
  if (user.role !== "ADMIN") return { response: error(403, "Admins only.") };
  return { user };
}
