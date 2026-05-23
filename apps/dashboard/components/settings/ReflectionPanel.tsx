"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateReflection, resolveReflection } from "@/app/actions/reflection";
import type { ReflectionProposal } from "@/types/forge";

type ReflectionPanelProps = {
  proposals: ReflectionProposal[];
  projectId?: string;
};

export function ReflectionPanel({ proposals, projectId }: ReflectionPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const open = proposals.filter((proposal) => proposal.status === "proposed");

  if (open.length === 0) {
    return (
      <section className="settings-section">
        <div className="settings-card-header">
          <h2>Reflection proposals</h2>
          <button className="btn btn-secondary" disabled={isPending} onClick={() => run()} type="button">
            {isPending ? "Running..." : "Run reflection"}
          </button>
        </div>
        <p className="settings-empty">
          No open Forge self-improvement proposals. Run reflection to generate one from this project's feedback and
          build history.
        </p>
      </section>
    );
  }

  function run() {
    startTransition(async () => {
      await generateReflection({ projectId });
      router.refresh();
    });
  }

  function decide(proposal: ReflectionProposal, decision: "accepted" | "rejected") {
    startTransition(async () => {
      await resolveReflection({ proposalId: proposal.id, projectId: proposal.projectId, decision });
      router.refresh();
    });
  }

  return (
    <section className="settings-section">
      <div className="settings-card-header">
        <h2>Reflection proposals</h2>
        <button className="btn btn-secondary" disabled={isPending} onClick={() => run()} type="button">
          {isPending ? "Running..." : "Run reflection"}
        </button>
      </div>
      <p className="settings-desc">
        Review Forge self-improvement proposals before changing rubrics, scoring, eval cases, or preferences.
      </p>
      <ul className="reflection-list">
        {open.map((proposal) => (
          <li className="reflection-item" key={proposal.id}>
            <div className="reflection-copy">
              <p className="reflection-type">
                {proposal.proposalType.replace(/_/g, " ")} · {proposal.riskLevel.replace(/_/g, " ")}
              </p>
              <strong>{proposal.title}</strong>
              <p>{proposal.rationale}</p>
            </div>
            <div className="reflection-actions">
              <button
                className="btn btn-secondary"
                disabled={isPending}
                onClick={() => decide(proposal, "rejected")}
                type="button"
              >
                Reject
              </button>
              <button
                className="btn btn-primary"
                disabled={isPending}
                onClick={() => decide(proposal, "accepted")}
                type="button"
              >
                Accept
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
