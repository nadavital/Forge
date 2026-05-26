"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { requestMagicLinkAction } from "@/app/actions/auth";

type LoginFormProps = {
  configured: boolean;
  submitLabel?: string;
};

const initialState = { ok: false, message: "" };

export function LoginForm({ configured, submitLabel = "Email me a sign-in link" }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(requestMagicLinkAction, initialState);

  return (
    <form action={formAction} className="auth-form">
      <label className="settings-field">
        <span>Email</span>
        <input className="field-input" disabled={!configured || isPending} name="email" placeholder="you@example.com" type="email" />
      </label>
      <button className="btn btn-primary" disabled={!configured || isPending} type="submit">
        <Mail aria-hidden="true" />
        {isPending ? "Sending..." : submitLabel}
      </button>
      {state.message ? <p className={state.ok ? "auth-message success" : "auth-message error"}>{state.message}</p> : null}
    </form>
  );
}
