import Link from "next/link";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { isBuildRecommendation } from "@/lib/decision";
import type { ContractOpportunity } from "@/types/forge";

type OpportunityCardProps = {
  opportunity: ContractOpportunity;
  projectId: string;
};

export function OpportunityCard({ opportunity, projectId }: OpportunityCardProps) {
  const href = `/projects/${projectId}/opportunities/${opportunity.id}`;
  const building = opportunity.build && !["completed", "failed"].includes(opportunity.build.status);
  const built = opportunity.build?.status === "completed";
  const primary = isBuildRecommendation(opportunity.decision.recommendation);

  return (
    <Link className="opportunity-card" href={href}>
      <div className="card-accent" aria-hidden="true" />

      <div className="card-body">
        <h2 className="card-title">{opportunity.title}</h2>
        <p className="card-summary">{opportunity.decision.summary}</p>
      </div>

      <footer className="card-foot">
        {building ? (
          <span className="card-status building">
            <LoaderCircle aria-hidden="true" className="spin" />
            Building
          </span>
        ) : built ? (
          <span className="card-status complete">Build complete</span>
        ) : (
          <span className={`card-cta ${primary ? "primary" : ""}`}>
            {primary ? "Review" : "Open"}
            <ArrowUpRight aria-hidden="true" />
          </span>
        )}
      </footer>
    </Link>
  );
}
