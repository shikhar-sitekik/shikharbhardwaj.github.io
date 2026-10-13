import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/context";

export default async function SettingsIndex() {
  const ctx = await requireContext();
  redirect(ctx.permissions.has("admin:users") ? "/settings/users" : "/settings/profile");
}
