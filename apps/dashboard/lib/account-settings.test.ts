import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("account page separates Forge email identity from GitHub connectors", () => {
  const source = readFileSync(new URL("../app/(app)/account/page.tsx", import.meta.url), "utf8");

  assert.match(source, /Email is your account\. GitHub is a connector\./);
  assert.match(source, /GitHub never signs you into Forge/);
  assert.match(source, /Supabase email account/);
  assert.match(source, /Generated-repo account/);
});

test("sidebar exposes account navigation only after sign-in", () => {
  const source = readFileSync(new URL("../components/shell/AppSidebar.tsx", import.meta.url), "utf8");
  const signedInBranch = source.slice(
    source.indexOf("{authSession.signedIn ? ("),
    source.indexOf(") : authSession.signInConfigured")
  );

  assert.match(signedInBranch, /href="\/account"/);
  assert.match(signedInBranch, /Sign out/);
});
