"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, ChevronDown, ExternalLink, LoaderCircle, Sparkles } from "lucide-react";
import { startAntigravityBuild } from "@/app/actions/build";
import { refineOpportunity } from "@/app/actions/refine";
import { submitReview } from "@/app/actions/review";
import { buildOpportunityNarrative } from "@/lib/opportunity-narrative";
import type { ContractOpportunity, ReviewAction } from "@/types/forge";

type OpportunityDetailProps = {
  opportunity: ContractOpportunity;
  projectId: string;
  projectName: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
};

export function OpportunityDetail({ opportunity, projectId, projectName }: OpportunityDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [showSignals, setShowSignals] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const narrative = useMemo(() => buildOpportunityNarrative(opportunity), [opportunity]);

  const building = opportunity.build && !["completed", "failed"].includes(opportunity.build.status);
  const built = opportunity.build?.status === "completed";
  const canBuild = !building && !built;

  useEffect(() => {
    if (!building) return;
    const interval = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [building, router]);

  function review(action: ReviewAction) {
    startTransition(async () => {
      const result = await submitReview({ projectId, opportunityId: opportunity.id, action });
      setStatus(result.message);
      router.refresh();
    });
  }

  function build() {
    startTransition(async () => {
      const result = await startAntigravityBuild({ projectId, opportunityId: opportunity.id });
      setStatus(result.message);
      router.refresh();
    });
  }

  function onRefine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isPending) return;

    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text }]);
    setPrompt("");

    startTransition(async () => {
      const result = await refineOpportunity({ projectId, opportunityId: opportunity.id, prompt: text });
      setMessages((current) => [
        ...current,
        {
          id: `agent-${Date.now()}`,
          role: "agent",
          text: result.ok ? result.message : result.message
        }
      ]);
      if (result.ok) {
        setStatus(result.message);
      }
    });
  }

  return (
    <div className="review-shell">
      <header className="review-header">
        <Link className="back-link" href={`/projects/${projectId}`}>
          <ArrowLeft aria-hidden="true" />
          {projectName}
        </Link>
        <h1>{narrative.title}</h1>
        <p className="review-verdict">{narrative.verdict}</p>
      </header>

      <div className="review-transcript">
        <article className="neural-response">
          <div aria-hidden="true" className="neural-response-glow" />
          <div className="neural-response-inner">
            <p className="response-story">{narrative.story}</p>
            <p className="response-tension">{narrative.tension}</p>
            <p className="response-taste">{narrative.taste}</p>
            <div className="response-mvp">
              <span className="response-label">Suggested MVP</span>
              <p>{narrative.mvp}</p>
            </div>

            {narrative.prototypes && narrative.prototypes.length > 0 ? (
              <div className="response-mvp">
                <span className="response-label">Prototype option</span>
                <p>
                  {narrative.prototypes[0].title} · {narrative.prototypes[0].status}
                </p>
              </div>
            ) : null}

            {narrative.signalCount > 0 ? (
              <div className="response-signals">
                <button
                  aria-expanded={showSignals}
                  className="signals-toggle"
                  onClick={() => setShowSignals((open) => !open)}
                  type="button"
                >
                  {narrative.signalCount} supporting signal{narrative.signalCount === 1 ? "" : "s"}
                  <ChevronDown aria-hidden="true" className={showSignals ? "open" : ""} />
                </button>
                {showSignals ? (
                  <ul className="signals-list">
                    {narrative.signals.map((signal) => (
                      <li key={signal.text}>
                        {signal.url ? (
                          <a href={signal.url} rel="noreferrer" target="_blank">
                            {signal.text}
                            <ExternalLink aria-hidden="true" />
                          </a>
                        ) : (
                          signal.text
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {narrative.buildLine ? (
              <div className="response-build">
                <p>{narrative.buildLine}</p>
                {narrative.buildLogs ? <p className="build-logs">{narrative.buildLogs}</p> : null}
                {narrative.buildLinks?.map((link) => (
                  <a href={link.url} key={link.url} rel="noreferrer" target="_blank">
                    {link.label}
                    <ExternalLink aria-hidden="true" />
                  </a>
                ))}
                {narrative.artifacts && narrative.artifacts.length > 0 ? (
                  <div className="artifact-list">
                    {narrative.artifacts.map((artifact) => (
                      <details className="artifact-item" key={artifact.label}>
                        <summary>{artifact.label}</summary>
                        <p>{artifact.content}</p>
                      </details>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>

        {messages.map((message) => (
          <article className={`chat-turn ${message.role}`} key={message.id}>
            <p>{message.text}</p>
          </article>
        ))}

        {status ? (
          <p className="review-status" role="status">
            {status}
          </p>
        ) : null}
      </div>

      <footer className="review-composer">
        <form className="composer-form" onSubmit={onRefine}>
          <div className="composer-input-wrap">
            <textarea
              aria-label="Refine this opportunity"
              className="composer-input"
              disabled={isPending}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Push back, narrow scope, or ask for a different angle…"
              rows={2}
              value={prompt}
            />
            <div className="composer-toolbar">
              <div className="composer-secondary">
                <button className="composer-quiet" disabled={isPending} onClick={() => review("reject")} type="button">
                  Pass
                </button>
                <button className="composer-quiet" disabled={isPending} onClick={() => review("watch")} type="button">
                  Watch
                </button>
                <button
                  className="composer-quiet"
                  disabled={isPending}
                  onClick={() => review("research_more")}
                  type="button"
                >
                  Research
                </button>
              </div>

              <div className="composer-primary">
                {canBuild ? (
                  <button className="btn btn-build" disabled={isPending} onClick={build} type="button">
                    {isPending ? (
                      <>
                        <LoaderCircle aria-hidden="true" className="spin" />
                        Starting…
                      </>
                    ) : (
                      <>
                        <Sparkles aria-hidden="true" />
                        Build
                      </>
                    )}
                  </button>
                ) : building ? (
                  <span className="build-state building">
                    <LoaderCircle aria-hidden="true" className="spin" />
                    Building
                  </span>
                ) : built ? (
                  <span className="build-state complete">Complete</span>
                ) : null}

                <button
                  aria-label="Send refinement"
                  className="composer-send"
                  disabled={isPending || !prompt.trim()}
                  type="submit"
                >
                  <ArrowUp aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </form>
      </footer>
    </div>
  );
}
