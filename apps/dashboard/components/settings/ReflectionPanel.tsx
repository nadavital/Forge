"use client";

import { useTransition } from "react";
import { generateReflection, resolveReflection } from "@/app/actions/reflection";
import type { ReflectionProposal } from "@/types/forge";

type ReflectionPanelProps = {
  proposals: ReflectionProposal[];
  projectId?: string;
};

export function ReflectionPanel({ proposals, projectId }: ReflectionPanelProps) {
  const [isPending, startTransition] = useTransition();
  const open = proposals.filter((proposal) => proposal.status === "proposed");

  if (open.length === 0) {
    return (
      <section className="settings-card">
        <div className="settings-card-header">
          <h2>Reflection proposals</h2>
          <button className="btn btn-secondary" disabled={isPending} onClick={() => run()} type="button">
            Run reflection
          </button>
        </div>
        <p className="settings-empty">No open Forge self-improvement proposals.</p>
      </section>
    );
  }

  function run() {
    startTransition(async () => {
      await generateReflection({ projectId });
    });
  }

  function decide(proposal: ReflectionProposal, decision: "accepted" | "rejected") {
    startTransition(async () => {
      await resolveReflection({ proposalId: proposal.id, projectId: proposal.projectId, decision });
    });
  }

  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <h2>Reflection proposals</h2>
        <button className="btn btn-secondary" disabled={isPending} onClick={() => run()} type="button">
          Run reflection
        </button>
      </div>
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
