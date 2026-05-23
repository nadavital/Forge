"use client";

import { useTransition } from "react";
import { resolveReflection } from "@/app/actions/reflection";
import type { ReflectionProposal } from "@/types/forge";

type ReflectionPanelProps = {
  proposals: ReflectionProposal[];
};

export function ReflectionPanel({ proposals }: ReflectionPanelProps) {
  const [isPending, startTransition] = useTransition();
  const open = proposals.filter((proposal) => proposal.status === "proposed");

  if (open.length === 0) {
    return (
      <section className="settings-card">
        <h2>Reflection proposals</h2>
        <p className="settings-empty">No open Forge self-improvement proposals.</p>
      </section>
    );
  }

  function decide(proposal: ReflectionProposal, decision: "accepted" | "rejected") {
    startTransition(async () => {
      await resolveReflection({ proposalId: proposal.id, projectId: proposal.projectId, decision });
    });
  }

  return (
    <section className="settings-card">
      <h2>Reflection proposals</h2>
      <p className="settings-desc">Review-required changes Forge wants to make to its own behavior.</p>
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
