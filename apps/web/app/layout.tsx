import type { Metadata } from "next";
import "./globals.css";

import { AuthProvider } from "@brandos/auth";
import { PLAuthBridge } from "@/lib/pl-auth-bridge";
// SPRINT2-CHANGE (F-05): bootstrapRenderers() populates the RendererRegistry so
// resolveRenderer() returns the correct React component for each artifact_type.
// Called here (Server Component, runs once per process) — no browser APIs used.
import { bootstrapRenderers } from "@brandos/presentation-layer";

bootstrapRenderers()

export const metadata: Metadata = {
  title: "BrandOS",
  description: "AI Growth Operating System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
   <html
  lang="en"
  className="h-full antialiased dark"
>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          {/* PLAuthBridge injects auth state into @brandos/presentation-layer
              shell components (WorkspaceShell, AdminShell) without coupling PL
              to @brandos/auth. Cleanup Sprint 2 — WS1. */}
          <PLAuthBridge>
            {children}
          </PLAuthBridge>
        </AuthProvider>
      </body>
    </html>
  );
}
