import { redirect } from "next/navigation";
import { getCurrentUser, publicUser } from "../../lib/auth";
import Onboarding from "./Onboarding";

export const dynamic = "force-dynamic"; // per-request auth check

export const metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.onboardedAt) redirect("/vault");
  return <Onboarding user={publicUser(user)} />;
}
