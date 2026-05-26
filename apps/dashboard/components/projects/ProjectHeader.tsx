"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { GitBranch, Settings2, Sparkles } from "lucide-react";
import { runProjectPipeline } from "@/app/actions/pipeline";
import type { ProjectPrimaryAction } from "@/lib/project-primary-action";

type ProjectHeaderProps = {
  projectId: string;
  projectName: string;
  mode: string;
  runStatus: string;
  primaryAction?: ProjectPrimaryAction;
  signalCount?: number;
  opportunityCount?: number;
};

export function ProjectHeader({
  projectId,
  projectName,
  mode,
  runStatus,
  primaryAction = defaultRunAction,
  signalCount = 0,
  opportunityCount = 0
}: ProjectHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const onReview = pathname === `/projects/${projectId}`;
  const onSettings = pathname === `/projects/${projectId}/settings`;

  function runAgain() {
    startTransition(async () => {
      await runProjectPipeline(projectId);
      router.refresh();
    });
  }

  return (
    <header className="project-header">
      <div className="project-header-top">
        <div className="project-header-copy">
          <h1>{projectName}</h1>
          <p className="project-subline">
            {mode} · {countLabel(signalCount, "signal")} · {countLabel(opportunityCount, "suggestion")}
          </p>
          <span className={isPending ? "dream-status active" : "dream-status"}>
            {isPending
              ? primaryAction.kind === "run"
                ? primaryAction.pendingStatus
                : primaryAction.status
              : primaryAction.kind === "conversation" || primaryAction.kind === "setup"
                ? primaryAction.status
                : runStatus}
          </span>
        </div>

        {onReview && primaryAction.kind === "run" ? (
          <button className="btn btn-secondary" disabled={isPending} onClick={runAgain} type="button">
            <Sparkles aria-hidden="true" />
            {isPending ? primaryAction.pendingLabel : primaryAction.label}
          </button>
        ) : null}
        {onReview && primaryAction.kind === "conversation" ? (
          <Link className="btn btn-secondary" href={primaryAction.href}>
            <Sparkles aria-hidden="true" />
            {primaryAction.label}
          </Link>
        ) : null}
        {onReview && primaryAction.kind === "setup" ? (
          <Link className="btn btn-secondary" href={primaryAction.href}>
            <GitBranch aria-hidden="true" />
            {primaryAction.label}
          </Link>
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
          <Settings2 aria-hidden="true" />
          Settings
        </Link>
      </nav>
    </header>
  );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const defaultRunAction: ProjectPrimaryAction = {
  kind: "run",
  label: "Dream now",
  pendingLabel: "Dreaming...",
  pendingStatus: "Starting staged run: collect -> research -> Bull/Bear -> synthesize"
};
