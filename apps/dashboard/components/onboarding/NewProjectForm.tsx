"use client";

import { useTransition } from "react";
import { Link2, Sparkles } from "lucide-react";
import { createProject } from "@/app/actions/project";
import type { ProjectMode } from "@/types/forge";

const modes: Array<{
  id: ProjectMode;
  title: string;
  description: string;
  icon: typeof Link2;
}> = [
  {
    id: "connected_product",
    title: "Connected product",
    description: "Forge watches feedback, issues, and usage from something you already ship.",
    icon: Link2
  },
  {
    id: "new_product",
    title: "New product",
    description: "Start from manual ideas and taste notes while you shape a greenfield concept.",
    icon: Sparkles
  }
];

export function NewProjectForm() {
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      await createProject({
        name: String(formData.get("name") ?? ""),
        mode: formData.get("mode") as ProjectMode,
        repoUrl: String(formData.get("repoUrl") ?? "")
      });
    });
  }

  return (
    <form action={onSubmit} className="onboarding-form">
      <section className="onboarding-panel">
        <p className="onboarding-kicker">Start here</p>
        <h2>What are you building with Forge?</h2>
        <p className="onboarding-lead">
          Pick a mode, name the project, then configure sources and taste before the first morning review.
        </p>

        <div className="mode-grid">
          {modes.map((mode, index) => (
            <label className="mode-card" key={mode.id}>
              <input defaultChecked={index === 0} name="mode" type="radio" value={mode.id} />
              <span className="mode-card-inner">
                <span className="mode-icon">
                  <mode.icon aria-hidden="true" />
                </span>
                <span className="mode-copy">
                  <strong>{mode.title}</strong>
                  <span>{mode.description}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="onboarding-panel">
        <label className="field-label" htmlFor="project-name">
          Project name
        </label>
        <input
          autoComplete="off"
          className="field-input"
          disabled={isPending}
          id="project-name"
          name="name"
          placeholder="Acme Console"
          required
        />

        <label className="field-label" htmlFor="repo-url">
          GitHub repository
        </label>
        <input
          autoComplete="off"
          className="field-input"
          disabled={isPending}
          id="repo-url"
          name="repoUrl"
          placeholder="https://github.com/rkibel/auto-drone"
        />
        <button className="btn btn-primary btn-wide" disabled={isPending} type="submit">
          {isPending ? "Creating…" : "Create project"}
        </button>
      </section>
    </form>
  );
}
