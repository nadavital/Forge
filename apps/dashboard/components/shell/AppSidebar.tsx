"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, LogOut, Plus } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { plural } from "@/lib/decision";
import { useProjects } from "@/lib/projects-context";
import type { AuthSessionView } from "@/types/forge";

export function AppSidebar({ authSession }: { authSession: AuthSessionView }) {
  const pathname = usePathname();
  const projects = useProjects();
  const activeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];

  return (
    <aside className="app-sidebar" aria-label="Forge navigation">
      <div className="sidebar-brand">
        <Link className="brand-link" href="/">
          <span aria-hidden="true" className="brand-mark" />
          Forge
        </Link>
      </div>

      <nav className="sidebar-section" aria-label="Projects">
        <div className="sidebar-section-head">
          <span>Projects</span>
          <Link aria-label="New project" className="icon-btn" href="/projects/new" title="New project">
            <Plus aria-hidden="true" />
          </Link>
        </div>

        <ul className="project-nav">
          {projects.map((project) => {
            const active = project.id === activeProjectId;

            return (
              <li key={project.id}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={active ? "project-link active" : "project-link"}
                  href={`/projects/${project.id}`}
                >
                  <span className="project-link-name">{project.name}</span>
                  <span className="project-link-meta">
                    {plural(project.opportunities.length, "opportunity", "opportunities")} · {project.mode}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        <div className="sidebar-identity">
          <span>{authSession.signedIn ? "Signed in" : authSession.mode === "env_override" ? "Server identity" : "Local"}</span>
          <strong>{authSession.label}</strong>
          <small>{authSession.detail}</small>
        </div>
        {authSession.signedIn ? (
          <form action={signOutAction}>
            <button className="footer-link footer-button" type="submit">
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </form>
        ) : authSession.signInConfigured ? (
          <Link className="footer-link" href="/login">
            <LogIn aria-hidden="true" />
            Email sign in
          </Link>
        ) : (
          <Link className="footer-link" href="/login">
            <LogIn aria-hidden="true" />
            Configure sign-in
          </Link>
        )}
      </div>
    </aside>
  );
}
