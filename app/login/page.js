import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import AuthShell from "../components/AuthShell";
import { LoginForm } from "../components/AuthForms";

export const dynamic = "force-dynamic"; // per-request auth check

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  let user = null;
  try { user = await getCurrentUser(); } catch (err) { console.error(err); }
  if (user) redirect(user.onboardedAt ? "/vault" : "/onboarding");
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
