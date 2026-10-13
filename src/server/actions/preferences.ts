"use server";

import { cookies } from "next/headers";

export async function setThemeAction(theme: "system" | "light" | "dark"): Promise<void> {
  const jar = await cookies();
  if (theme === "system") jar.delete("theme");
  else jar.set("theme", theme, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365, httpOnly: false });
}
