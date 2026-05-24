"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Play } from "lucide-react";
import { runDueSchedules } from "@/app/actions/scheduler";
import type { SchedulerOverview } from "@/types/forge";

type SchedulerControlProps = {
  overview: SchedulerOverview;
  projectId?: string;
};

export function SchedulerControl({ overview, projectId }: SchedulerControlProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    startTransition(async () => {
      const result = await runDueSchedules({ projectId });
      setMessage(result.message);
    });
  }

  return (
    <section className="scheduler-panel" aria-label="Scheduler">
      <div className="scheduler-copy">
        <span className="scheduler-icon">
          <CalendarClock aria-hidden="true" />
        </span>
        <div>
          <h2>Dream schedule</h2>
          <p>
            {overview.activeCount} active · {overview.dueCount} due
            {overview.lastRunAt ? ` · last run ${formatTime(overview.lastRunAt)}` : ""}
          </p>
          {message ? <p className="scheduler-message">{message}</p> : null}
        </div>
      </div>
      <button className="btn btn-secondary" disabled={isPending || overview.dueCount === 0} onClick={run} type="button">
        <Play aria-hidden="true" />
        {isPending ? "Dreaming..." : "Run due dreams"}
      </button>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
