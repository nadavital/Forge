"use server";

import { checkRuntimeHealth } from "@/lib/runtime/health";

export async function checkRuntimeHealthAction() {
  return checkRuntimeHealth();
}
