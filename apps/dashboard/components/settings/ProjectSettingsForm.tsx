"use client";

import { useTransition } from "react";
import { Archive, CheckCircle2, Circle, GitBranch, Save } from "lucide-react";
import { archiveProject } from "@/app/actions/project";
import { saveProjectSettings } from "@/app/actions/settings";
import type { ProjectSettingsView } from "@/types/forge";

type ProjectSettingsFormProps = {
  projectId: string;
  settings: ProjectSettingsView;
};

export function ProjectSettingsForm({ projectId, settings }: ProjectSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const sourceStatuses: Record<string, string> = {};
      const triggerStatuses: Record<string, string> = {};

      for (const source of settings.sources) {
        sourceStatuses[source.id] = String(formData.get(`source-${source.id}`) ?? source.status);
      }
      for (const trigger of settings.triggers) {
        triggerStatuses[trigger.id] = String(formData.get(`trigger-${trigger.id}`) ?? trigger.status);
      }

      await saveProjectSettings({
        projectId,
        repoUrl: String(formData.get("repoUrl") ?? settings.project.repoUrl),
        productUrl: String(formData.get("productUrl") ?? settings.project.productUrl),
        description: String(formData.get("description") ?? settings.project.description),
        riskTolerance: String(formData.get("riskTolerance") ?? settings.preferences.riskTolerance),
        markets: String(formData.get("markets") ?? settings.preferences.markets.join(", ")),
        notes: String(formData.get("notes") ?? settings.preferences.notes),
        sourceStatuses,
        triggerStatuses
      });
    });
  }

  function onArchive() {
    if (!window.confirm("Archive this project? It will be hidden and its triggers disabled.")) {
      return;
    }

    startTransition(async () => {
      await archiveProject(projectId);
    });
  }

  return (
    <div className="settings-form">
      <form action={onSubmit} className="settings-form">
        <section className="settings-card">
          <h2>Project onboarding</h2>
          <p className="settings-desc">The minimum setup Forge needs before reviews are worth trusting.</p>
          <ul className="settings-checklist">
            {settings.onboarding.checklist.map((item) => (
              <li key={item.id}>
                {item.complete ? (
                  <CheckCircle2 aria-hidden="true" className="check-complete" />
                ) : (
                  <Circle aria-hidden="true" className="check-pending" />
                )}
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="settings-card">
          <h2>Repository connection</h2>
          <p className="settings-desc">
            GitHub is stored as project metadata and mirrored into the GitHub source config.
          </p>
          <div className="settings-fields">
            <label className="field-label" htmlFor="repoUrl">
              GitHub repository
            </label>
            <div className="field-with-icon settings-field-icon">
              <GitBranch aria-hidden="true" />
              <input
                defaultValue={settings.project.repoUrl}
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
              defaultValue={settings.project.productUrl}
              disabled={isPending}
              id="productUrl"
              name="productUrl"
              placeholder="https://example.com"
            />

            <label className="field-label" htmlFor="description">
              Project context
            </label>
            <textarea
              defaultValue={settings.project.description}
              disabled={isPending}
              id="description"
              name="description"
              rows={4}
            />
          </div>
        </section>

        <section className="settings-card">
          <h2>Sources</h2>
          <p className="settings-desc">Inputs that feed ranking and research for this project.</p>
          <ul className="settings-rows editable">
            {settings.sources.map((source) => (
              <li key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <span>{source.type.replace(/_/g, " ")}</span>
                </div>
                <select defaultValue={source.status} disabled={isPending} name={`source-${source.id}`}>
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="error">error</option>
                </select>
              </li>
            ))}
          </ul>
        </section>

        <section className="settings-card">
          <h2>Triggers</h2>
          <p className="settings-desc">When Forge runs for this project.</p>
          <ul className="settings-rows editable">
            {settings.triggers.map((trigger) => (
              <li key={trigger.id}>
                <div>
                  <strong>{trigger.name}</strong>
                  <span>{trigger.type}</span>
                </div>
                <select defaultValue={trigger.status} disabled={isPending} name={`trigger-${trigger.id}`}>
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="disabled">disabled</option>
                </select>
              </li>
            ))}
          </ul>
        </section>

        <section className="settings-card">
          <h2>Preference profile</h2>
          <p className="settings-desc">Explicit taste used when ranking opportunities.</p>
          <div className="settings-fields">
            <label className="field-label" htmlFor="riskTolerance">
              Risk tolerance
            </label>
            <select
              defaultValue={settings.preferences.riskTolerance}
              disabled={isPending}
              id="riskTolerance"
              name="riskTolerance"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>

            <label className="field-label" htmlFor="markets">
              Preferred markets
            </label>
            <input
              defaultValue={settings.preferences.markets.join(", ")}
              disabled={isPending}
              id="markets"
              name="markets"
            />

            <label className="field-label" htmlFor="notes">
              Notes
            </label>
            <textarea defaultValue={settings.preferences.notes} disabled={isPending} id="notes" name="notes" rows={4} />
          </div>
        </section>

        <button className="btn btn-primary btn-wide" disabled={isPending} type="submit">
          <Save aria-hidden="true" />
          {isPending ? "Saving…" : "Save project settings"}
        </button>
      </form>

      <section className="settings-card danger-card">
        <h2>Remove project</h2>
        <p className="settings-desc">
          Archive hides this project from active reviews and disables its triggers while preserving its records.
        </p>
        <button className="btn btn-danger" disabled={isPending} onClick={onArchive} type="button">
          <Archive aria-hidden="true" />
          Archive project
        </button>
      </section>
    </div>
  );
}
