"use client";

import { useTransition } from "react";
import { GitBranch } from "lucide-react";
import { createProject } from "@/app/actions/project";

export function NewProjectForm() {
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const repoUrl = String(formData.get("repoUrl") ?? "");
      await createProject({
        name: String(formData.get("name") ?? ""),
        mode: repoUrl.trim() ? "connected_product" : "new_product",
        repoUrl,
        productUrl: String(formData.get("productUrl") ?? ""),
        description: String(formData.get("description") ?? ""),
        markets: String(formData.get("markets") ?? ""),
        riskTolerance: String(formData.get("riskTolerance") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        scheduleCadence: String(formData.get("scheduleCadence") ?? "daily")
      });
    });
  }

  return (
    <form action={onSubmit} className="onboarding-form">
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
            Existing GitHub repository optional
          </label>
          <p className="field-help">
            Connect a repo if you already have a product. Leave this blank for a new-product idea; Forge will create a
            generated repo when you approve a build.
          </p>
          <div className="field-with-icon">
            <GitBranch aria-hidden="true" />
            <input
              autoComplete="off"
              className="field-input"
              disabled={isPending}
              id="repoUrl"
              name="repoUrl"
              placeholder="Optional: nadavital/forge or https://github.com/org/repo"
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

          <label className="field-label" htmlFor="scheduleCadence">
            Dream schedule
          </label>
          <p className="field-help">
            Forge can wake up automatically, reflect on prior decisions, and refresh the project review. You can change
            this later in Settings.
          </p>
          <select
            className="field-input"
            defaultValue="daily"
            disabled={isPending}
            id="scheduleCadence"
            name="scheduleCadence"
          >
            <option value="daily">Daily</option>
            <option value="twice_daily">Twice daily</option>
            <option value="weekly">Weekly</option>
            <option value="paused">Off for now</option>
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
