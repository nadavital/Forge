"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { checkRuntimeHealthAction } from "@/app/actions/runtime";
import type { RuntimeHealthResult } from "@/lib/runtime/health";
import type { ProjectSettingsView } from "@/types/forge";

type RuntimeReadinessPanelProps = {
  items: ProjectSettingsView["runtimeReadiness"];
};

export function RuntimeReadinessPanel({ items }: RuntimeReadinessPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [health, setHealth] = useState<RuntimeHealthResult | null>(null);
  const healthById = new Map(health?.items.map((item) => [item.id, item]));

  function checkHealth() {
    startTransition(async () => {
      setHealth(await checkRuntimeHealthAction());
    });
  }

  return (
    <section className="settings-section">
      <div className="settings-card-header">
        <div>
          <h2>Runtime readiness</h2>
          <p className="settings-desc">Live paths are shown without exposing secret values to the browser.</p>
        </div>
        <button className="btn btn-secondary btn-compact" disabled={isPending} onClick={checkHealth} type="button">
          {isPending ? "Checking..." : "Check live paths"}
        </button>
      </div>

      <div className="readiness-grid">
        {items.map((item) => {
          const Icon = iconFor(item.status);
          const healthItem = healthById.get(item.id);
          return (
            <article className={`readiness-item ${item.status}`} key={item.id}>
              <div className="readiness-title">
                <Icon aria-hidden="true" />
                <div>
                  <h3>{item.label}</h3>
                  <span>{labelFor(item.status)}</span>
                </div>
              </div>
              <p>{item.summary}</p>
              <small>{item.detail}</small>
              {item.missing.length ? (
                <div className="readiness-missing" aria-label={`${item.label} missing configuration`}>
                  {item.missing.map((name) => (
                    <code key={name}>{name}</code>
                  ))}
                </div>
              ) : null}
              {item.setup.length ? (
                <div className="readiness-setup" aria-label={`${item.label} setup values`}>
                  {item.setup.map((setup) => (
                    <div key={`${setup.label}:${setup.value}`}>
                      <span>{setup.label}</span>
                      {isHttpUrl(setup.value) ? (
                        <a href={setup.value} rel="noreferrer" target="_blank">
                          {setup.value}
                        </a>
                      ) : (
                        <code>{setup.value}</code>
                      )}
                      {setup.proof ? (
                        <small className={`readiness-proof ${setupProofStatus(setup, healthItem)}`}>
                          {setupProofLabel(setup, healthItem)}
                        </small>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {healthItem ? (
                <div className={`readiness-health ${healthItem.status}`} role="status">
                  <strong>{healthLabel(healthItem.status)}</strong>
                  <span>{healthItem.summary}</span>
                  {healthItem.detail ? <small>{healthItem.detail}</small> : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {health ? <p className="settings-desc">Last checked {formatDateTime(health.checkedAt)}.</p> : null}
    </section>
  );
}

function iconFor(status: ProjectSettingsView["runtimeReadiness"][number]["status"]) {
  if (status === "ready") return CircleCheck;
  if (status === "partial") return CircleAlert;
  return CircleDashed;
}

function labelFor(status: ProjectSettingsView["runtimeReadiness"][number]["status"]): string {
  if (status === "ready") return "Ready";
  if (status === "partial") return "Partial";
  return "Missing";
}

function healthLabel(status: RuntimeHealthResult["items"][number]["status"]): string {
  if (status === "ok") return "Checked";
  if (status === "warning") return "Warning";
  if (status === "error") return "Error";
  return "Skipped";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function setupProofStatus(
  setup: ProjectSettingsView["runtimeReadiness"][number]["setup"][number],
  healthItem?: RuntimeHealthResult["items"][number]
): "unchecked" | "proved" | "not-proved" {
  if (setup.proof?.kind === "callback_flow") return "unchecked";
  if (!healthItem) return "unchecked";
  return healthItem.status === "ok" ? "proved" : "not-proved";
}

function setupProofLabel(
  setup: ProjectSettingsView["runtimeReadiness"][number]["setup"][number],
  healthItem?: RuntimeHealthResult["items"][number]
): string {
  if (!setup.proof) return "";
  if (setup.proof.kind === "callback_flow") return setup.proof.uncheckedLabel;
  if (!healthItem) return setup.proof.uncheckedLabel;
  return healthItem.status === "ok" ? setup.proof.provedLabel : setup.proof.notProvedLabel;
}
