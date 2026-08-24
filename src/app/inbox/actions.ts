"use server";

import { redirect } from "next/navigation";
import { clearAdminCookie } from "@/lib/auth";

export async function logout() {
  await clearAdminCookie();
  redirect("/login");
}
