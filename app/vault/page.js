import { redirect } from "next/navigation";
import { getCurrentUser, publicUser } from "../../lib/auth";
import VaultApp from "./VaultApp";

export const dynamic = "force-dynamic"; // per-request auth check

export const metadata = { title: "Your vault" };

export default async function VaultPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <VaultApp user={publicUser(user)} />;
}
