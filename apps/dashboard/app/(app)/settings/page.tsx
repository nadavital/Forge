import { ReflectionPanel } from "@/components/settings/ReflectionPanel";
import { getForgeSettingsView } from "@/lib/db/repository";
import { loadReflectionProposals } from "@/lib/forge-data";

export default async function ForgeSettingsPage() {
  const [forgeSettings, proposals] = await Promise.all([getForgeSettingsView(), loadReflectionProposals()]);

  return (
    <main className="page page-narrow">
      <header className="page-header">
        <p className="run-eyebrow">Workspace</p>
        <h1>Forge settings</h1>
        <p className="page-lead">Defaults that apply across all projects.</p>
      </header>

      <div className="settings-stack">
        <section className="settings-card">
          <h2>Managed builder</h2>
          <p className="settings-desc">External sandbox that turns approved opportunities into repos.</p>
          <dl className="settings-kv">
            <div>
              <dt>Adapter</dt>
              <dd>{forgeSettings.builder}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h2>Human approval gate</h2>
          <p className="settings-desc">Builds cannot start without explicit opportunity approval.</p>
          <dl className="settings-kv">
            <div>
              <dt>Policy</dt>
              <dd>{forgeSettings.humanGate}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h2>Guardrails</h2>
          <p className="settings-desc">Constraints enforced on every managed build.</p>
          <ul className="guardrail-list">
            {forgeSettings.guardrails.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <ReflectionPanel proposals={proposals} />
      </div>
    </main>
  );
}
