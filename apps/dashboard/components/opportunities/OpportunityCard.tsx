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
    <article className="opportunity-card">
      <div className="card-accent" aria-hidden="true" />

      <div className="card-body">
        <span className={`evidence-badge ${opportunity.evidenceState}`}>{opportunity.evidenceLabel}</span>
        <h2 className="card-title">
          <Link href={href}>{opportunity.title}</Link>
        </h2>
        <p className="card-summary">{opportunity.problem || opportunity.decision.summary}</p>
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
          <Link className={`card-cta ${primary ? "primary" : ""}`} href={href}>
            {primary ? "Review" : "Open"}
            <ArrowUpRight aria-hidden="true" />
          </Link>
        )}
        {opportunity.build?.prUrl ? (
          <a className="card-pr-link" href={opportunity.build.prUrl} rel="noreferrer" target="_blank">
            <GitHubMark />
            View PR
          </a>
        ) : null}
      </footer>
    </article>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" className="github-mark" viewBox="0 0 16 16">
      <path
        d="M8 0C3.58 0 0 3.67 0 8.2c0 3.62 2.29 6.69 5.47 7.77.4.08.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.16-.28-.16-.68-.56-.01-.57.63-.01 1.08.59 1.23.84.72 1.24 1.87.89 2.33.68.07-.53.28-.89.51-1.09-1.78-.21-3.64-.91-3.64-4.03 0-.89.31-1.62.82-2.19-.08-.21-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.42 7.42 0 0 1 8 3.94c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.95.08 2.16.51.57.82 1.3.82 2.19 0 3.13-1.87 3.82-3.65 4.03.29.26.54.75.54 1.52 0 1.09-.01 1.97-.01 2.24 0 .22.15.48.55.4A8.22 8.22 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z"
        fill="currentColor"
      />
    </svg>
  );
}
