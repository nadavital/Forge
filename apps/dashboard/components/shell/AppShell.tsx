"use client";

import type { ReactNode } from "react";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { NeuralAmbient } from "@/components/shell/NeuralAmbient";
import type { AuthSessionView } from "@/types/forge";

export function AppShell({ authSession, children }: { authSession: AuthSessionView; children: ReactNode }) {
  return (
    <div className="app-frame">
      <NeuralAmbient />
      <AppSidebar authSession={authSession} />
      <div className="app-content">{children}</div>
    </div>
  );
}
