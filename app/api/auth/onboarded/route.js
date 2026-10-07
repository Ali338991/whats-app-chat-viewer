import { prisma } from "../../../../lib/prisma";
import { json, handler } from "../../../../lib/api";
import { requireUser } from "../../../../lib/auth";

// POST /api/auth/onboarded — the user finished or skipped onboarding.
export const POST = handler(async () => {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!user.onboardedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
  }
  return json({ ok: true });
});
