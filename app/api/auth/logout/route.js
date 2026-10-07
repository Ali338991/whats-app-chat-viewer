import { json, handler } from "../../../../lib/api";
import { clearSessionCookie, getCurrentUser } from "../../../../lib/auth";
import { logEvent } from "../../../../lib/audit";

export const POST = handler(async (request) => {
  let user = null;
  try { user = await getCurrentUser(); } catch { /* sign out regardless */ }
  await clearSessionCookie();
  if (user) await logEvent(request, user.id, { type: "LOGOUT" });
  return json({ ok: true });
});
