// Admin user helpers (server only).
import { prisma } from "./prisma";

export async function listUsersWithUsage() {
  const [users, usage] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { chats: true } } },
    }),
    prisma.chat.groupBy({ by: ["userId"], _sum: { totalBytes: true } }),
  ]);
  const used = new Map(usage.map((u) => [u.userId, Number(u._sum.totalBytes || 0n)]));
  return users.map((u) => serializeAdminUser(u, used.get(u.id) || 0, u._count.chats));
}

export function serializeAdminUser(u, usedBytes = 0, chatCount = 0) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    active: u.active,
    storageLimitBytes: u.storageLimitBytes == null ? null : Number(u.storageLimitBytes),
    usedBytes,
    chatCount,
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
