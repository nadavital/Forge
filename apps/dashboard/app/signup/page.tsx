import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const configured = isSupabaseAuthConfigured();

  return (
    <main className="page page-onboarding">
      <section className="auth-card">
        <div>
          <p className="project-eyebrow">Forge account</p>
          <h1>Create your account</h1>
          <p>
            Start with an email-based Forge account. After signup, connect GitHub only for selected repos or generated
            repo targets.
          </p>
        </div>
        {!configured ? (
          <p className="auth-message error">
            Hosted signup needs <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code>.
          </p>
        ) : null}
        <LoginForm configured={configured} submitLabel="Email me a signup link" />
        <Link className="btn btn-secondary" href="/login">
          Sign in instead
        </Link>
      </section>
    </main>
  );
}
