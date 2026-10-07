// Audit log helpers (server only).
// Logging must NEVER break the app: every write is wrapped in try/catch and
// failures only go to the console (e.g. if the AuditEvent table doesn't exist
// yet because the migration hasn't been applied).
import { prisma } from "./prisma";

export const AUTH_TYPES = ["LOGIN", "SIGNUP", "LOGOUT", "LOGIN_FAILED"];
export const MEDIA_TYPES = ["MEDIA_VIEW", "VIDEO_PLAY", "AUDIO_PLAY", "DOC_DOWNLOAD"];
export const ACTIVITY_TYPES = ["CHAT_OPEN", ...MEDIA_TYPES];
export const ADMIN_TYPES = [
  "ADMIN_CHAT_OPEN", "ADMIN_CHAT_RESTORE", "ADMIN_CHAT_DELETE", "ADMIN_PURGE",
  "ADMIN_USER_CREATE", "ADMIN_USER_UPDATE", "ADMIN_USER_DELETE",
];
export const ALL_TYPES = [...AUTH_TYPES, ...ACTIVITY_TYPES, ...ADMIN_TYPES];

const cut = (v, n) => (typeof v === "string" && v ? v.slice(0, n) : null);

// IP / user agent / Vercel geo headers from the incoming request.
export function requestContext(request) {
  const h = request?.headers;
  if (!h || typeof h.get !== "function") return {};
  const xff = h.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : h.get("x-real-ip") || "").trim();
  let city = h.get("x-vercel-ip-city");
  if (city) { try { city = decodeURIComponent(city); } catch { /* keep raw */ } }
  return {
    ip: cut(ip, 100),
    userAgent: cut(h.get("user-agent"), 300),
    country: cut(h.get("x-vercel-ip-country"), 10),
    city: cut(city, 120),
  };
}

function row(ctx, userId, d) {
  return {
    userId,
    type: String(d.type).slice(0, 40),
    chatId: d.chatId ?? null,
    chatName: cut(d.chatName, 200),
    mediaId: d.mediaId ?? null,
    mediaName: cut(d.mediaName, 255),
    mediaKind: cut(d.mediaKind, 20),
    targetUserId: d.targetUserId ?? null,
    meta: d.meta ?? undefined,
    ...ctx,
  };
}

// Record one event. Never throws.
export async function logEvent(request, userId, data) {
  if (!userId || !data?.type) return;
  try {
    await prisma.auditEvent.create({ data: row(requestContext(request), userId, data) });
  } catch (err) {
    console.error("[audit] failed to log", data.type, err?.message || err);
  }
}

// Record several events for one user. Never throws.
export async function logEvents(request, userId, list) {
  if (!userId || !list?.length) return 0;
  const ctx = requestContext(request);
  try {
    const r = await prisma.auditEvent.createMany({ data: list.map((d) => row(ctx, userId, d)) });
    return r.count;
  } catch (err) {
    console.error("[audit] failed to log batch", err?.message || err);
    return 0;
  }
}

// True if the same user already has this event type for this chat recently.
// On any error returns false (i.e. log anyway; the write itself is guarded).
export async function recentlyLogged(userId, type, chatId, minutes = 30) {
  try {
    const hit = await prisma.auditEvent.findFirst({
      where: { userId, type, chatId, createdAt: { gte: new Date(Date.now() - minutes * 60000) } },
      select: { id: true },
    });
    return !!hit;
  } catch {
    return false;
  }
}

// Log a chat open (user or admin), skipping signed-URL refreshes and repeats within 30 min.
export async function logChatOpen(request, userId, chat, { admin = false } = {}) {
  try {
    if (request?.nextUrl?.searchParams?.get("refresh") === "1") return;
    const type = admin ? "ADMIN_CHAT_OPEN" : "CHAT_OPEN";
    if (await recentlyLogged(userId, type, chat.id, 30)) return;
    await logEvent(request, userId, {
      type, chatId: chat.id, chatName: chat.name,
      ...(admin ? { targetUserId: chat.userId } : {}),
    });
  } catch (err) {
    console.error("[audit] chat open", err?.message || err);
  }
}

/* ---------------- dependency-free user-agent parsing ---------------- */
export function parseUserAgent(ua) {
  const s = String(ua || "");
  if (!s) return { browser: "Unknown", os: "Unknown", device: "desktop", label: "Unknown device" };
  let browser = "Other";
  if (/Edg(e|A|iOS)?\//.test(s)) browser = "Edge";
  else if (/SamsungBrowser\//.test(s)) browser = "Samsung Internet";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/Firefox\/|FxiOS\//.test(s)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";
  else if (/curl\//i.test(s)) browser = "curl";

  let os = "Other";
  if (/iPhone|iPad|iPod/.test(s)) os = "iOS";
  else if (/Android/.test(s)) os = "Android";
  else if (/Windows/.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux/.test(s)) os = "Linux";

  const device = /Mobi|iPhone|iPod|Android.*Mobile|iPad|Tablet/.test(s) ? "mobile" : "desktop";
  return { browser, os, device, label: `${browser} · ${os} · ${device}` };
}

/* ---------------- serialization + pagination ---------------- */
export function serializeEvent(e) {
  return {
    id: e.id,
    type: e.type,
    createdAt: e.createdAt,
    chatId: e.chatId,
    chatName: e.chatName,
    mediaId: e.mediaId,
    mediaName: e.mediaName,
    mediaKind: e.mediaKind,
    targetUserId: e.targetUserId,
    meta: e.meta,
    ip: e.ip,
    country: e.country,
    city: e.city,
    userAgent: e.userAgent,
    device: parseUserAgent(e.userAgent),
    ...(e.user ? { actor: { id: e.user.id, email: e.user.email, firstName: e.user.firstName, lastName: e.user.lastName } } : {}),
  };
}

export const PAGE_SIZE = 50;

// Cursor pagination (newest first). `cursor` is the id of the last item of the previous page.
export async function pageEvents(where, cursor, include) {
  const items = await prisma.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...(include ? { include } : {}),
  });
  const hasMore = items.length > PAGE_SIZE;
  const page = hasMore ? items.slice(0, PAGE_SIZE) : items;
  return { events: page.map(serializeEvent), nextCursor: hasMore ? page[page.length - 1].id : null };
}

// Validated ?cursor= (cuid-ish) or null.
export function cursorParam(request) {
  const c = request.nextUrl.searchParams.get("cursor");
  return c && /^[a-z0-9]{10,40}$/i.test(c) ? c : null;
}
