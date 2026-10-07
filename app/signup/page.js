import { redirect } from "next/navigation";
import { getCurrentUser, signupsEnabled } from "../../lib/auth";
import AuthShell from "../components/AuthShell";
import { SignupForm } from "../components/AuthForms";

export const dynamic = "force-dynamic"; // per-request auth check

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  let user = null;
  try { user = await getCurrentUser(); } catch (err) { console.error(err); }
  if (user) redirect("/vault");
  return (
    <AuthShell>
      <SignupForm enabled={signupsEnabled()} />
    </AuthShell>
  );
}
