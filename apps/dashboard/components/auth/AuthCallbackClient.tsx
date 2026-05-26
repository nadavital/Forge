"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { completeSupabaseAuthAction } from "@/app/actions/auth";

export function AuthCallbackClient() {
  const router = useRouter();
  const [message, setMessage] = useState("Completing sign-in...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search.replace(/^\?/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = Number(params.get("expires_in") || 0) || null;
    window.history.replaceState(null, "", "/auth/callback");
    if (!accessToken) {
      setMessage("The sign-in link did not include a session token.");
      return;
    }

    completeSupabaseAuthAction({ accessToken, refreshToken, expiresIn }).then((result) => {
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMessage(result.message);
      router.replace("/");
    });
  }, [router]);

  return (
    <main className="page page-onboarding">
      <section className="auth-card" aria-live="polite">
        <h1>Sign in</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}
