"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, CheckCircle2, LoaderCircle, PlayCircle, SearchCheck } from "lucide-react";
import { approveResearchBrief, runQueuedResearch, sendIdeaMessage } from "@/app/actions/idea";
import { ideaConversationCanContinue } from "@/lib/ideas/conversation-state";
import type { IdeaConversationView, ResearchBriefView, ResearchEvidenceSummaryView } from "@/types/forge";

type AgentTaskView = IdeaConversationView["agentTasks"][number];

type IdeaIntakePanelProps = {
  projectId: string;
  conversation: IdeaConversationView | null;
};

export function IdeaIntakePanel({ projectId, conversation }: IdeaIntakePanelProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const brief = conversation?.latestBrief;
  const queuedResearchRunId =
    conversation?.latestResearchRun &&
    (conversation.latestResearchRun.status === "queued" || conversation.latestResearchRun.status === "running")
      ? conversation.latestResearchRun.id
      : null;
  const canResearch = (brief?.status === "ready_for_research" || brief?.status === "approved") && !queuedResearchRunId;
  const openQuestions = brief?.status === "needs_context" ? brief.openQuestions.filter(Boolean).slice(0, 3) : [];
  const canContinueConversation = ideaConversationCanContinue(conversation);
  const composerPlaceholder = !canContinueConversation
    ? "What should Forge explore next?"
    : openQuestions[0] || "What are you thinking about building?";
  const evidenceSummary = conversation?.latestResearchRun?.evidenceSummary;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isPending) return;
    setDraft("");
    startTransition(async () => {
      const result = await sendIdeaMessage({
        projectId,
        conversationId: canContinueConversation ? conversation?.id : undefined,
        message
      });
      setStatus(result.message);
      router.refresh();
    });
  }

  function onResearch() {
    if (!brief || isPending) return;
    startTransition(async () => {
      const result = await approveResearchBrief({ projectId, briefId: brief.id });
      setStatus(result.message);
      router.refresh();
    });
  }

  function onRunQueuedResearch() {
    if (!queuedResearchRunId || isPending) return;
    startTransition(async () => {
      const result = await runQueuedResearch({ projectId, runId: queuedResearchRunId });
      setStatus(result.message);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="idea-intake-heading" className="idea-panel">
      <div className="idea-panel-head">
        <div>
          <span className="section-kicker">Explore idea</span>
          <h2 id="idea-intake-heading">Talk through a direction</h2>
        </div>
        {brief ? <BriefStatus status={brief.status} /> : null}
      </div>

      {conversation?.messages.length ? (
        <div className="idea-thread" aria-label="Idea conversation">
          {conversation.messages.slice(-6).map((message) => (
            <article className={`idea-message ${message.role}`} key={message.id}>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
      ) : null}

      {brief ? (
        <article className="brief-card">
          <div>
            <span className="response-label">{brief.status === "needs_context" ? "Draft brief" : "Research brief"}</span>
            <h3>{brief.hypothesis}</h3>
            {brief.painArea ? <p>{brief.painArea}</p> : null}
          </div>
          <BriefReadinessSummary brief={brief} />
          <div className="brief-grid">
            <BriefList label="Users" items={brief.targetUsers} />
            <BriefList label="Sources" items={brief.sourcePlan} />
            <BriefList label="Stop if" items={brief.disqualifyingEvidence} />
            <BriefList label="MVP" items={brief.mvpBoundaries} />
          </div>
          <BriefList className="brief-open-questions" label="Next" items={openQuestions} />
          {canResearch ? (
            <button className="btn btn-build" disabled={isPending} onClick={onResearch} type="button">
              {isPending ? <LoaderCircle aria-hidden="true" className="spin" /> : <SearchCheck aria-hidden="true" />}
              {brief.status === "approved" ? "Start research" : "Research this"}
            </button>
          ) : null}
        </article>
      ) : null}

      {conversation?.agentTasks.length ? (
        <ResearchAgentProgress
          isPending={isPending}
          onRunQueuedResearch={onRunQueuedResearch}
          queuedResearchRunId={queuedResearchRunId}
          tasks={conversation.agentTasks}
        />
      ) : null}

      {evidenceSummary ? <ResearchEvidenceStatus summary={evidenceSummary} /> : null}

      <form className="idea-form" onSubmit={onSubmit}>
        {!canContinueConversation && conversation ? (
          <span className="idea-form-note">This research thread is complete. Your next message starts a new direction.</span>
        ) : null}
        <textarea
          aria-label="Idea direction"
          disabled={isPending}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={composerPlaceholder}
          rows={3}
          value={draft}
        />
        <button aria-label="Send idea" className="composer-send" disabled={isPending || !draft.trim()} type="submit">
          {isPending ? <LoaderCircle aria-hidden="true" className="spin" /> : <ArrowUp aria-hidden="true" />}
        </button>
      </form>

      {status ? (
        <p className="review-status" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function BriefReadinessSummary({ brief }: { brief: ResearchBriefView }) {
  const missing = missingBriefSections(brief);
  const confidence = confidenceLabel(brief.confidence);
  const ready = brief.status !== "needs_context" && missing.length === 0;

  return (
    <div aria-label="Brief readiness" className={`brief-readiness ${ready ? "ready" : "needs_context"}`}>
      <div>
        <strong>{ready ? "Ready for source-backed research" : "Needs more product context"}</strong>
        <span>{briefReadinessDetail(brief.status, missing.length)}</span>
      </div>
      <ul>
        {confidence ? <li>{confidence}</li> : null}
        {missing.length ? (
          missing.slice(0, 3).map((section) => <li key={section}>Missing {section}</li>)
        ) : (
          <li>Core brief fields present</li>
        )}
      </ul>
    </div>
  );
}

function missingBriefSections(brief: ResearchBriefView): string[] {
  const sections: string[] = [];
  if (!brief.hypothesis.trim()) sections.push("hypothesis");
  if (!brief.targetUsers.length) sections.push("target users");
  if (!brief.painArea.trim()) sections.push("pain area");
  if (!brief.sourcePlan.length) sections.push("source plan");
  if (!brief.mvpBoundaries.length) sections.push("MVP boundary");
  return sections;
}

function confidenceLabel(confidence: number | null | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return `AI confidence ${Math.round(Math.max(0, Math.min(confidence, 1)) * 100)}%`;
}

function briefReadinessDetail(status: string, missingCount: number): string {
  if (status === "approved") return "Approved and waiting for research agents.";
  if (status === "running") return "Research agents are working from this brief.";
  if (status === "completed") return "Research completed from this brief.";
  if (missingCount > 0) return "Answer the next prompt before approving research.";
  return "The brief has enough structure for sourced research.";
}

function ResearchAgentProgress({
  isPending,
  onRunQueuedResearch,
  queuedResearchRunId,
  tasks
}: {
  isPending: boolean;
  onRunQueuedResearch: () => void;
  queuedResearchRunId: string | null;
  tasks: AgentTaskView[];
}) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const activeTask = tasks.find((task) => task.status === "running") ?? tasks.find((task) => task.status === "queued");
  const progress = Math.round((completed / Math.max(tasks.length, 1)) * 100);

  return (
    <div className="agent-progress-panel" aria-label="Research agent progress">
      <div className="agent-progress-head">
        <div>
          <span className="response-label">Agent research</span>
          <strong>{completed} of {tasks.length} roles complete</strong>
          {activeTask ? <p>{activeTask.phase}: {activeTask.stateLabel ?? activeTask.status}</p> : null}
        </div>
        {queuedResearchRunId ? (
          <button className="btn btn-secondary" disabled={isPending} onClick={onRunQueuedResearch} type="button">
            {isPending ? <LoaderCircle aria-hidden="true" className="spin" /> : <PlayCircle aria-hidden="true" />}
            Run now
          </button>
        ) : null}
      </div>
      <div className="agent-progress-meter" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="agent-task-strip">
        {tasks.map((task) => (
          <span className={`agent-task ${task.status}`} key={task.id}>
            <strong>
              {task.phase}
              {task.stateLabel ? <em>{task.stateLabel}</em> : null}
            </strong>
            <small>
              <b>{task.role}</b>
              {task.detail ? ` · ${task.detail}` : ""}
            </small>
          </span>
        ))}
      </div>
    </div>
  );
}

function ResearchEvidenceStatus({ summary }: { summary: ResearchEvidenceSummaryView }) {
  const sourceAudit = summary.sourceAudit;
  const collectedSources = sourceAudit?.sources.map((source) => `${source.label} ${source.count}`).join(" · ");
  const plannedSources = sourceAudit?.enabledSources.join(" · ");
  const targets = sourceAudit?.targets.slice(0, 4).join(" · ");
  return (
    <div className={`research-evidence-status ${summary.status}`} aria-label="Research evidence status">
      <span>
        <SearchCheck aria-hidden="true" />
        {summary.label}
      </span>
      <p>{summary.detail}</p>
      {sourceAudit ? (
        <small>
          {collectedSources ? `Collected: ${collectedSources}` : plannedSources ? `Planned: ${plannedSources}` : ""}
          {targets ? ` · Targets: ${targets}` : ""}
        </small>
      ) : null}
    </div>
  );
}

function BriefStatus({ status }: { status: string }) {
  return (
    <span className={`brief-status ${status}`}>
      <CheckCircle2 aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

function BriefList({ className, label, items }: { className?: string; label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={["brief-list", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      <ul>
        {items.slice(0, 3).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "ready_for_research") return "Ready";
  if (status === "needs_context") return "More context";
  return status;
}
