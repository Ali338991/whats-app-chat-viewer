import { json, handler } from "../../../../lib/api";
import { clearSessionCookie } from "../../../../lib/auth";

export const POST = handler(async () => {
  await clearSessionCookie();
  return json({ ok: true });
});
