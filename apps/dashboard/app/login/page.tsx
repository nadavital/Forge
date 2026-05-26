import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const signedOut = params.signed_out === "1";
  const configured = isSupabaseAuthConfigured();

  return (
    <main className="page page-onboarding">
      <section className="auth-card">
        <div>
          <p className="project-eyebrow">Forge account</p>
          <h1>Sign in with email</h1>
          <p>
            Your Forge account uses email through Supabase Auth. GitHub is connected later as a repo connector, not as
            your primary login.
          </p>
        </div>
        {signedOut ? <p className="auth-message success">Signed out.</p> : null}
        {!configured ? (
          <p className="auth-message error">
            Hosted email auth needs <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code>.
          </p>
        ) : null}
        <LoginForm configured={configured} />
        <Link className="btn btn-secondary" href="/signup">
          Create account
        </Link>
        <Link className="btn btn-secondary" href="/">
          Continue locally
        </Link>
      </section>
    </main>
  );
}
