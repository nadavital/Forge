"use client";

import { useTransition } from "react";
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
        riskTolerance: String(formData.get("riskTolerance") ?? settings.preferences.riskTolerance),
        markets: String(formData.get("markets") ?? settings.preferences.markets.join(", ")),
        notes: String(formData.get("notes") ?? settings.preferences.notes),
        sourceStatuses,
        triggerStatuses
      });
    });
  }

  return (
    <form action={onSubmit} className="settings-form">
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
        {isPending ? "Saving…" : "Save project settings"}
      </button>
    </form>
  );
}
