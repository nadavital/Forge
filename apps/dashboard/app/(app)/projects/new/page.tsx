import { NewProjectForm } from "@/components/onboarding/NewProjectForm";
import { NeuralAmbient } from "@/components/shell/NeuralAmbient";

export default function NewProjectPage() {
  return (
    <main className="page page-onboarding">
      <NeuralAmbient />
      <div className="onboarding-shell">
        <header className="onboarding-hero">
          <p className="onboarding-kicker">Forge</p>
          <h1>Set up a project</h1>
          <p className="onboarding-lead">
            Connected products ingest live signals. New products start from ideas you enter manually. You can tune
            sources, triggers, and taste on the next screen.
          </p>
        </header>
        <NewProjectForm />
      </div>
    </main>
  );
}
