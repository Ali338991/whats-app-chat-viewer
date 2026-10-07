// Small helpers shared by the route handlers (server only).

// JSON response that safely serializes BigInt (Prisma BigInt columns) as numbers.
export function json(data, init = {}) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(body, { ...init, headers });
}

export function error(status, message, extra = {}) {
  return json({ error: message, ...extra }, { status });
}

// Parse a JSON body; returns null when missing/invalid.
export async function readJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export const isInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isInteger(v) && v >= min && v <= max;

export function optString(v, max) {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return undefined; // invalid
  return v.slice(0, max);
}

// Wrap a handler so unexpected errors become a clean 500 (and are logged).
export function handler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      // redirect()/notFound() from next/navigation throw special errors — rethrow them
      if (err && typeof err === "object" && typeof err.digest === "string" && err.digest.startsWith("NEXT_")) throw err;
      if (!err?.expose) console.error(err);
      const msg = err?.expose ? err.message : "Something went wrong. Please try again.";
      return error(err?.status || 500, msg);
    }
  };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

export function serializeChat(c) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    me: c.me,
    messageCount: c.messageCount,
    mediaCount: c.mediaCount,
    totalBytes: Number(c.totalBytes),
    firstDate: c.firstDate,
    lastDate: c.lastDate,
    preview: c.preview,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// Admin view of a chat: adds soft-delete info.
export function serializeAdminChat(c) {
  const deletedAt = c.deletedAt || null;
  return {
    ...serializeChat(c),
    deletedAt,
    daysSinceDeleted: deletedAt ? Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000) : null,
    ...(c.user ? { owner: { id: c.user.id, email: c.user.email, firstName: c.user.firstName, lastName: c.user.lastName } } : {}),
  };
}
