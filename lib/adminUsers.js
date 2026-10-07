// Admin user helpers (server only).
import { prisma } from "./prisma";

// Per-user storage split: active (counts toward quota) vs removed by the user.
async function usageByUser(where = {}) {
  const rows = await prisma.chat.groupBy({
    by: ["userId", "deletedAt"],
    where,
    _sum: { totalBytes: true },
    _count: { _all: true },
  });
  const map = new Map();
  for (const r of rows) {
    const u = map.get(r.userId) || { usedBytes: 0, deletedBytes: 0, chatCount: 0, deletedCount: 0 };
    const bytes = Number(r._sum.totalBytes || 0n);
    if (r.deletedAt) { u.deletedBytes += bytes; u.deletedCount += r._count._all; }
    else { u.usedBytes += bytes; u.chatCount += r._count._all; }
    map.set(r.userId, u);
  }
  return map;
}

export async function userUsage(userId) {
  return (await usageByUser({ userId })).get(userId) || { usedBytes: 0, deletedBytes: 0, chatCount: 0, deletedCount: 0 };
}

export async function listUsersWithUsage() {
  const [users, usage] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    usageByUser(),
  ]);
  return users.map((u) => serializeAdminUser(u, usage.get(u.id)));
}

export function serializeAdminUser(u, usage = {}) {
  const { usedBytes = 0, deletedBytes = 0, chatCount = 0, deletedCount = 0 } = usage;
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    active: u.active,
    storageLimitBytes: u.storageLimitBytes == null ? null : Number(u.storageLimitBytes),
    usedBytes,
    deletedBytes,
    chatCount,
    deletedCount,
    locked: !!(u.lockedUntil && u.lockedUntil > new Date()),
    lockedUntil: u.lockedUntil,
    lastLoginAt: u.lastLoginAt,
    onboarded: !!u.onboardedAt,
    createdAt: u.createdAt,
  };
}

export function parseLimit(v) {
  if (v === null || v === undefined || v === "") return { value: null };
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1024 ** 5) return { error: "Invalid storage limit." };
  return { value: BigInt(Math.round(v)) };
}
