import { decisionLabels } from "@/lib/decision";
import type { ContractOpportunity } from "@/types/forge";

export type OpportunityNarrative = {
  title: string;
  verdict: string;
  story: string;
  taste: string;
  tension: string;
  mvp: string;
  signalCount: number;
  signals: Array<{ text: string; url?: string | null }>;
  buildLine?: string;
  buildLinks?: Array<{ label: string; url: string }>;
  buildLogs?: string;
  artifacts?: Array<{ label: string; content: string }>;
};

export function buildOpportunityNarrative(opportunity: ContractOpportunity): OpportunityNarrative {
  const decision = decisionLabels[opportunity.decision.recommendation].toLowerCase();
  const confidence = Math.round(opportunity.decision.confidence * 100);

  const story = [
    opportunity.problem,
    `Built for ${opportunity.targetUser.toLowerCase()}.`,
    opportunity.decision.summary
  ].join(" ");

  const tension = `${opportunity.debate.bull} Still, ${opportunity.debate.bear.charAt(0).toLowerCase()}${opportunity.debate.bear.slice(1)}`;

  let buildLine: string | undefined;
  let buildLinks: Array<{ label: string; url: string }> | undefined;
  let buildLogs: string | undefined;
  let artifacts: Array<{ label: string; content: string }> | undefined;

  if (opportunity.build) {
    if (opportunity.build.status === "completed") {
      buildLine = "Build complete.";
    } else if (opportunity.build.status === "failed") {
      buildLine = "The last build attempt failed.";
    } else {
      buildLine = `Build is ${opportunity.build.status.replace("_", " ")}.`;
    }

    buildLogs = opportunity.build.logs ?? undefined;
    buildLinks = [
      ...(opportunity.build.prUrl ? [{ label: "Pull request", url: opportunity.build.prUrl }] : []),
      ...(opportunity.build.generatedRepoUrl
        ? [{ label: "Generated repo", url: opportunity.build.generatedRepoUrl }]
        : [])
    ];

    artifacts = opportunity.build.artifacts?.map((artifact) => ({
      label: artifact.type.replace(/_/g, " "),
      content: artifact.content || "Available"
    }));
  }

  return {
    title: opportunity.title,
    verdict: `${decision} · ${confidence}% confidence · score ${opportunity.score}`,
    story,
    taste: opportunity.tasteCritique,
    tension,
    mvp: opportunity.mvpConcept,
    signalCount: opportunity.evidence.length,
    signals: opportunity.evidence.map((item) => ({
      text: item.label,
      url: item.url
    })),
    buildLine,
    buildLinks: buildLinks && buildLinks.length > 0 ? buildLinks : undefined,
    buildLogs,
    artifacts
  };
}
