import { NewProjectForm } from "@/components/onboarding/NewProjectForm";
import { NeuralAmbient } from "@/components/shell/NeuralAmbient";

export default function NewProjectPage() {
  return (
    <main className="page page-onboarding">
      <NeuralAmbient />
      <div className="onboarding-shell">
        <header className="onboarding-hero">
          <h1>Set up a project</h1>
        </header>
        <NewProjectForm />
      </div>
    </main>
  );
}
