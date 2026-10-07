import { json } from "../../../../lib/api";
import { getCurrentUser, publicUser } from "../../../../lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return json({ user: publicUser(user) });
  } catch (err) {
    // DB not configured/reachable — behave as signed out rather than erroring the local app
    console.error(err);
    return json({ user: null });
  }
}
