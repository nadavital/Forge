"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Settings2, Sparkles } from "lucide-react";
import { runProjectPipeline } from "@/app/actions/pipeline";

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
            {isPending ? "Starting staged run: collect → research → Bull/Bear → synthesize" : runStatus}
          </span>
        </div>

        {onReview ? (
          <button className="btn btn-secondary" disabled={isPending} onClick={runAgain} type="button">
            <Sparkles aria-hidden="true" />
            {isPending ? "Dreaming…" : "Dream now"}
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
