"use client";

import type { ReactNode } from "react";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { NeuralAmbient } from "@/components/shell/NeuralAmbient";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <NeuralAmbient />
      <AppSidebar />
      <div className="app-content">{children}</div>
    </div>
  );
}
