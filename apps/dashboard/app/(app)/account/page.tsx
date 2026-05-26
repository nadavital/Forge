import Link from "next/link";
import { GitBranch, KeyRound, LogOut, Mail, ShieldCheck } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { loadAccountSettingsView } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const account = await loadAccountSettingsView();
  const primaryProject = account.projectLinks[0];

  return (
    <main className="page page-narrow">
      <section className="project-hero">
        <p className="project-eyebrow">Forge account</p>
        <h1>Email is your account. GitHub is a connector.</h1>
        <p>
          Forge keeps product memory, projects, opportunities, and build history under the email account. GitHub access is
          attached only when a project or generated repo target needs it.
        </p>
      </section>

      <div className="settings-stack">
        <section className="settings-section">
          <div className="settings-card-header">
            <div>
              <h2>Primary Identity</h2>
              <p className="settings-desc">This is the account boundary for Forge data.</p>
            </div>
            <Mail aria-hidden="true" className="settings-header-icon" />
          </div>
          <dl className="settings-kv">
            <div>
              <dt>Mode</dt>
              <dd>{account.authSession.signedIn ? "Supabase email account" : account.authSession.label}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{account.identity.email || (account.authSession.signedIn ? account.authSession.label : "Not signed in")}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{account.identity.workspaceId}</dd>
            </div>
            <div>
              <dt>Auth source</dt>
              <dd>{account.identity.authProvider === "supabase" ? "Supabase Auth" : "Local/server identity"}</dd>
            </div>
          </dl>
          <form action={signOutAction} className="settings-inline">
            <button className="btn btn-secondary" type="submit">
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </form>
        </section>

        <section className="settings-section">
          <div className="settings-card-header">
            <div>
              <h2>Access Guard</h2>
              <p className="settings-desc">Private beta access is enforced before and after Supabase session validation.</p>
            </div>
            <ShieldCheck aria-hidden="true" className="settings-header-icon" />
          </div>
          <dl className="settings-kv">
            <div>
              <dt>Email allowlist</dt>
              <dd>{account.emailAllowlistEnabled ? "Enabled" : "Not configured"}</dd>
            </div>
            <div>
              <dt>Project scope</dt>
              <dd>{account.projectLinks.length} visible project{account.projectLinks.length === 1 ? "" : "s"}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-section">
          <div className="settings-card-header">
            <div>
              <h2>GitHub Connectors</h2>
              <p className="settings-desc">GitHub never signs you into Forge. It only grants scoped repo access.</p>
            </div>
            <GitBranch aria-hidden="true" className="settings-header-icon" />
          </div>

          {account.githubConnections.length ? (
            <ul className="settings-rows">
              {account.githubConnections.map((connection) => (
                <li key={connection.id}>
                  <div>
                    <strong>{connection.accountLogin}</strong>
                    <span>
                      {connectionLabel(connection.provider)} · {connection.accountType || "GitHub account"} ·{" "}
                      {connection.status}
                    </span>
                    <small>{connectionPurpose(connection.provider)}</small>
                  </div>
                  <span className="status-pill">{connection.installationId ? "App install" : "OAuth"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-empty">No GitHub connectors are visible in this workspace yet.</p>
          )}

          <div className="settings-inline">
            {primaryProject ? (
              <Link className="btn btn-secondary" href={`/projects/${primaryProject.id}/settings`}>
                <KeyRound aria-hidden="true" />
                Manage connectors
              </Link>
            ) : (
              <Link className="btn btn-secondary" href="/projects/new">
                <KeyRound aria-hidden="true" />
                Create a project
              </Link>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function connectionLabel(provider: string): string {
  return provider === "github_oauth" ? "Generated-repo account" : "GitHub App";
}

function connectionPurpose(provider: string): string {
  return provider === "github_oauth"
    ? "Used only for generated repos owned by this GitHub user."
    : "Used for selected project repositories and organization generated-repo targets.";
}
