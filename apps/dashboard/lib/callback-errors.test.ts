import assert from "node:assert/strict";
import test from "node:test";
import { callbackSafeErrorMessage, redactCallbackText } from "./security/callback-errors.ts";

test("callback error messages allow only explicit local validation text", () => {
  assert.equal(
    callbackSafeErrorMessage(new Error("Enter a valid email address."), "Sign-in link could not be sent."),
    "Enter a valid email address."
  );
  assert.equal(
    callbackSafeErrorMessage(new Error("Email is not invited to this Forge workspace."), "Sign-in link could not be sent."),
    "Email is not invited to this Forge workspace."
  );
  assert.equal(
    callbackSafeErrorMessage(new Error("GitHub token exchange failed: 401 Bad credentials"), "GitHub user authorization could not be saved."),
    "GitHub user authorization could not be saved."
  );
});

test("callback error redaction removes configured secrets and token-shaped values", () => {
  const redacted = redactCallbackText(
    "provider failed with secret=client-secret access_token=ghu_access refresh_token=ghr_refresh Authorization: Bearer bearer-token",
    {
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      FORGE_AUTH_BEARER_COOKIE: "bearer-token"
    }
  );

  assert.doesNotMatch(redacted, /client-secret|ghu_access|ghr_refresh|bearer-token/);
  assert.match(redacted, /secret=\[REDACTED\]/);
  assert.match(redacted, /access_token=\[REDACTED\]/);
  assert.match(redacted, /refresh_token=\[REDACTED\]/);
  assert.match(redacted, /Authorization: Bearer \[REDACTED\]/);
});

test("callback-safe fallback is used after redaction instead of showing partial provider errors", () => {
  assert.equal(
    callbackSafeErrorMessage(
      new Error("Supabase failed with token=abc123 and body={\"message\":\"bad jwt\"}"),
      "Session could not be completed.",
      { SUPABASE_ANON_KEY: "abc123" }
    ),
    "Session could not be completed."
  );
});
