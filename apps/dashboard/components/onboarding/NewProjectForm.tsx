"use client";

import { useTransition } from "react";
import { FlaskConical, GitBranch, Link2, Sparkles } from "lucide-react";
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
  },
  {
    id: "sample_project",
    title: "Sample project",
    description: "Use fixture data to validate Forge without connecting production inputs.",
    icon: FlaskConical
  }
];

export function NewProjectForm() {
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      await createProject({
        name: String(formData.get("name") ?? ""),
        mode: formData.get("mode") as ProjectMode,
        repoUrl: String(formData.get("repoUrl") ?? ""),
        productUrl: String(formData.get("productUrl") ?? ""),
        description: String(formData.get("description") ?? ""),
        markets: String(formData.get("markets") ?? ""),
        riskTolerance: String(formData.get("riskTolerance") ?? ""),
        notes: String(formData.get("notes") ?? "")
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
        <div className="onboarding-fields">
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

          <label className="field-label" htmlFor="repoUrl">
            GitHub repository
          </label>
          <div className="field-with-icon">
            <GitBranch aria-hidden="true" />
            <input
              autoComplete="off"
              className="field-input"
              disabled={isPending}
              id="repoUrl"
              name="repoUrl"
              placeholder="nadavital/forge or https://github.com/org/repo"
            />
          </div>

          <label className="field-label" htmlFor="productUrl">
            Product URL
          </label>
          <input
            autoComplete="off"
            className="field-input"
            disabled={isPending}
            id="productUrl"
            name="productUrl"
            placeholder="https://example.com"
          />

          <label className="field-label" htmlFor="description">
            Project context
          </label>
          <textarea
            className="field-input"
            disabled={isPending}
            id="description"
            name="description"
            placeholder="What this project is, who it serves, and what Forge should watch for."
            rows={4}
          />

          <label className="field-label" htmlFor="markets">
            Markets
          </label>
          <input
            autoComplete="off"
            className="field-input"
            disabled={isPending}
            id="markets"
            name="markets"
            placeholder="Developer tools, AI agents"
          />

          <label className="field-label" htmlFor="riskTolerance">
            Risk tolerance
          </label>
          <select
            className="field-input"
            defaultValue="medium"
            disabled={isPending}
            id="riskTolerance"
            name="riskTolerance"
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>

          <label className="field-label" htmlFor="notes">
            Taste notes
          </label>
          <textarea
            className="field-input"
            disabled={isPending}
            id="notes"
            name="notes"
            placeholder="What should Forge prefer, avoid, or treat as evidence?"
            rows={3}
          />
        </div>
        <button className="btn btn-primary btn-wide" disabled={isPending} type="submit">
          {isPending ? "Creating…" : "Create project"}
        </button>
      </section>
    </form>
  );
}
