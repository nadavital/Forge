"use client";

import { useTransition } from "react";
import { GitBranch } from "lucide-react";
import { createProject } from "@/app/actions/project";

export function NewProjectForm() {
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const repoUrl = String(formData.get("repoUrl") ?? "");
      const initialIdea = String(formData.get("initialIdea") ?? "");
      await createProject({
        name: String(formData.get("name") ?? ""),
        mode: repoUrl.trim() ? "connected_product" : "new_product",
        repoUrl,
        initialIdea,
        productUrl: String(formData.get("productUrl") ?? ""),
        description: initialIdea
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
            GitHub repository
          </label>
          <p className="field-help">
            Connect an existing repo, or leave this blank to start with an AI-led idea conversation before any build repo exists.
          </p>
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

          <label className="field-label" htmlFor="initialIdea">
            Starting point
          </label>
          <p className="field-help">
            For new products, this becomes the first message in the AI idea conversation. For connected repos, it gives Forge context for the first review.
          </p>
          <textarea
            className="field-input"
            disabled={isPending}
            id="initialIdea"
            name="initialIdea"
            placeholder="Describe the product direction, user pain, or market hunch in your own words."
            rows={4}
          />
        </div>
        <button className="btn btn-primary btn-wide" disabled={isPending} type="submit">
          {isPending ? "Creating project…" : "Create project"}
        </button>
      </section>
    </form>
  );
}
