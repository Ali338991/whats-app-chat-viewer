import { redirect } from "next/navigation";
import { getCurrentUser, publicUser } from "../../lib/auth";
import AdminApp from "./AdminApp";

export const dynamic = "force-dynamic"; // per-request auth check

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/vault");
  return <AdminApp me={publicUser(user)} />;
}
