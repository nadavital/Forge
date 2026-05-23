"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MorningReviewProject } from "@/types/forge";

const ProjectsContext = createContext<MorningReviewProject[]>([]);

export function ProjectsProvider({
  children,
  projects
}: {
  children: ReactNode;
  projects: MorningReviewProject[];
}) {
  return <ProjectsContext.Provider value={projects}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  return useContext(ProjectsContext);
}

export function useProject(projectId: string) {
  const projects = useProjects();
  return projects.find((project) => project.id === projectId);
}
