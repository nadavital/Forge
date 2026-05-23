import { notFound } from "next/navigation";
import { OpportunityDetail } from "@/components/opportunities/OpportunityDetail";
import { loadDashboardOpportunity } from "@/lib/dashboard-data";

type OpportunityPageProps = {
  params: Promise<{ projectId: string; opportunityId: string }>;
};

export default async function OpportunityPage({ params }: OpportunityPageProps) {
  const { projectId, opportunityId } = await params;
  const result = await loadDashboardOpportunity(projectId, opportunityId);

  if (!result) {
    notFound();
  }

  const { project, opportunity } = result;

  return (
    <main className="page page-review">
      <OpportunityDetail opportunity={opportunity} projectId={project.id} projectName={project.name} />
    </main>
  );
}
