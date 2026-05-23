"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { plural } from "@/lib/decision";
import { useProjects } from "@/lib/projects-context";

export function AppSidebar() {
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
                  <span className="project-link-top">
                    <span className="project-link-name">{project.name}</span>
                    <span className="project-link-score">{project.opportunities[0]?.score ?? "—"}</span>
                  </span>
                  <span className="project-link-meta">
                    {plural(project.opportunities.length, "opportunity", "opportunities")} · {project.mode}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
