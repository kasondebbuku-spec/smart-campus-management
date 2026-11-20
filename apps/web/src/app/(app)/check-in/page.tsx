"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { outcomeFromError, outcomeFromResponse, tokenFromSearch, type CheckInOutcome, type CheckInResponse } from "@/lib/check-in";
import { formatTime } from "@/lib/time";

const STATUS_TEXT = {
  PRESENT: "Marked present",
  LATE: "Marked late",
  EXCUSED: "Your lecturer has marked you excused",
  ABSENT: "Your lecturer has marked you absent. Speak to them if that's wrong.",
} as const;

const STATUS_LOOK = {
  PRESENT: { icon: "✅", tone: "good" },
  LATE: { icon: "⏰", tone: "warn" },
  EXCUSED: { icon: "ℹ️", tone: "neutral" },
  ABSENT: { icon: "⚠️", tone: "bad" },
} as const;

// Opened by scanning the lecturer's QR code with a phone camera: /check-in?t=<code>.
export default function CheckInPage() {
  const { api, user } = useAuth();
  const [outcome, setOutcome] = useState<CheckInOutcome | null>(null);
  const [missing, setMissing] = useState(false);
  const sent = useRef(false);

  useEffect(() => {
    if (!user || sent.current) return;
    sent.current = true; // React may run effects twice in development; send the code once

    const token = tokenFromSearch(window.location.search);
    // Take the code out of the address bar so a refresh or the back button doesn't resend it.
    window.history.replaceState(null, "", "/check-in");
    if (!token) {
      setMissing(true);
      return;
    }
    if (user.role !== "STUDENT") {
      setOutcome({ kind: "problem", title: "Only students check in", detail: "You're signed in with a staff account.", tryAgain: false });
      return;
    }
    api
      .post<CheckInResponse>("/check-in", { token })
      .then((r) => setOutcome(outcomeFromResponse(r)))
      .catch((e) => setOutcome(outcomeFromError(e)));
  }, [api, user]);

  return (
    <div className="mx-auto max-w-md py-6 text-center">
      {missing && (
        <Card icon="📷" title="Scan the code to check in" tone="neutral">
          Point your phone camera at the QR code on your lecturer&apos;s screen and open the link it shows.
        </Card>
      )}

      {!missing && !outcome && (
        <div role="status" aria-live="polite" className="space-y-3 py-12">
          <div className="mx-auto size-10 animate-spin rounded-full border-4 border-brand-soft border-t-brand" aria-hidden />
          <p className="text-muted">Checking you in…</p>
        </div>
      )}

      {outcome?.kind === "success" && (
        <Card
          icon={STATUS_LOOK[outcome.status].icon}
          tone={STATUS_LOOK[outcome.status].tone}
          title={
            outcome.status === "ABSENT" || outcome.status === "EXCUSED"
              ? "Your attendance is already recorded"
              : outcome.already
                ? "You're already checked in"
                : "You're checked in"
          }
        >
          <span className="block text-lg font-semibold text-ink">{outcome.course}</span>
          <span className="mt-1 block">{STATUS_TEXT[outcome.status]}</span>
          <span className="mt-1 block text-sm">Recorded at {formatTime(outcome.recordedAt)}</span>
        </Card>
      )}

      {outcome?.kind === "problem" && (
        <Card icon="⚠️" title={outcome.title} tone="bad">
          {outcome.detail}
        </Card>
      )}

      <div className="mt-6 flex justify-center">
        <Link href="/dashboard" className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-canvas">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}

function Card({ icon, title, tone, children }: { icon: string; title: string; tone: "good" | "warn" | "bad" | "neutral"; children: React.ReactNode }) {
  const ring = { good: "border-emerald-200 bg-emerald-50", warn: "border-amber-200 bg-amber-50", bad: "border-red-200 bg-red-50", neutral: "border-line bg-surface" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-2xl border p-8 ${ring}`}>
      <div className="text-5xl" aria-hidden>
        {icon}
      </div>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted">{children}</p>
    </div>
  );
}
