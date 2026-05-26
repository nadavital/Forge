"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEFAULT_AUTH_ACCESS_COOKIE } from "@/lib/auth/request-session";
import {
  AUTH_REFRESH_COOKIE,
  requestSupabaseMagicLink,
  validatedSessionCookies
} from "@/lib/auth/supabase-auth";
import { callbackSafeErrorMessage } from "@/lib/security/callback-errors";

type AuthActionResult = {
  ok: boolean;
  message: string;
};

export async function requestMagicLinkAction(
  _previousState: AuthActionResult,
  formData: FormData
): Promise<AuthActionResult> {
  const email = String(formData.get("email") || "").trim();
  try {
    await requestSupabaseMagicLink({
      email,
      redirectTo: `${await requestOrigin()}/auth/callback`
    });
    return { ok: true, message: "Check your email for a Forge account link." };
  } catch (reason) {
    return { ok: false, message: callbackSafeErrorMessage(reason, "Sign-in link could not be sent.") };
  }
}

export async function completeSupabaseAuthAction(input: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
}): Promise<AuthActionResult> {
  try {
    const session = await validatedSessionCookies({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresIn: input.expiresIn
    });
    const jar = await cookies();
    const secure = (await requestOrigin()).startsWith("https://");
    jar.set(session.access.name, session.access.value, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: session.access.maxAge
    });
    if (session.refresh) {
      jar.set(session.refresh.name, session.refresh.value, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: session.refresh.maxAge
      });
    }
    revalidatePath("/");
    return {
      ok: true,
      message: session.user.email ? `Signed in as ${session.user.email}.` : "Signed in."
    };
  } catch (reason) {
    return { ok: false, message: callbackSafeErrorMessage(reason, "Session could not be completed.") };
  }
}

export async function signOutAction() {
  const jar = await cookies();
  jar.delete(DEFAULT_AUTH_ACCESS_COOKIE);
  jar.delete(AUTH_REFRESH_COOKIE);
  revalidatePath("/");
  redirect("/login?signed_out=1");
}

async function requestOrigin(): Promise<string> {
  const configured = process.env.FORGE_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_FORGE_APP_URL;
  if (configured?.trim()) {
    return configured.trim().replace(/\/$/, "");
  }
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
