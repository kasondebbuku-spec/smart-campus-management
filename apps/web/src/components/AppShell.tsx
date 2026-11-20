"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { RequireAuth } from "./RequireAuth";

const ROLE_LABEL = { ADMIN: "Administrator", LECTURER: "Lecturer", STUDENT: "Student" } as const;

function Header() {
  const { user, logout } = useAuth();
  const router = useRouter();
  if (!user) return null;

  async function signOut() {
    await logout();
    router.replace("/login");
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white" aria-hidden>
            SC
          </span>
          <span className="hidden sm:inline">Smart Campus</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">
              {user.firstName} {user.lastName}
            </div>
            <div className="text-xs text-muted">{ROLE_LABEL[user.role]}</div>
          </div>
          <button onClick={signOut} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-canvas">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </RequireAuth>
  );
}
