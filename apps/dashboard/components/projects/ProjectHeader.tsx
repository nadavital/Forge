"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { Play } from "lucide-react";
import { runProjectPipeline } from "@/app/actions/pipeline";
import { plural } from "@/lib/decision";

type ProjectHeaderProps = {
  projectId: string;
  projectName: string;
  mode: string;
  runStatus: string;
  signalCount?: number;
  opportunityCount?: number;
};

export function ProjectHeader({
  projectId,
  projectName,
  mode,
  runStatus,
  signalCount,
  opportunityCount
}: ProjectHeaderProps) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const onReview = pathname === `/projects/${projectId}`;
  const onSettings = pathname === `/projects/${projectId}/settings`;

  function runAgain() {
    startTransition(async () => {
      await runProjectPipeline(projectId);
    });
  }

  return (
    <header className="project-header">
      <div className="project-header-top">
        <div className="project-header-copy">
          <p className="project-eyebrow">{runStatus}</p>
          <h1>{projectName}</h1>
          <p className="project-subline">{mode}</p>
          {onReview && signalCount !== undefined && opportunityCount !== undefined ? (
            <p className="project-stats">
              {plural(signalCount, "signal")} · {plural(opportunityCount, "opportunity", "opportunities")}
            </p>
          ) : null}
        </div>

        {onReview ? (
          <button className="btn btn-secondary" disabled={isPending} onClick={runAgain} type="button">
            <Play aria-hidden="true" />
            {isPending ? "Running…" : "Run again"}
          </button>
        ) : null}
      </div>

      <nav aria-label="Project sections" className="project-tabs">
        <Link aria-current={onReview ? "page" : undefined} className="project-tab" href={`/projects/${projectId}`}>
          Review
        </Link>
        <Link
          aria-current={onSettings ? "page" : undefined}
          className="project-tab"
          href={`/projects/${projectId}/settings`}
        >
          Settings
        </Link>
      </nav>
    </header>
  );
}
