"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";

// Wraps pages that need a signed-in user. Sends everyone else to /login, remembering
// where they were going. The API still checks every request: this is only for UX.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signed-out") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== "signed-in") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted" role="status" aria-live="polite">
        Loading…
      </div>
    );
  }
  return <>{children}</>;
}
