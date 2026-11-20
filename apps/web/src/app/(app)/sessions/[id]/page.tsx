"use client";

import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { QrDisplay } from "@/components/QrDisplay";
import { Alert, BackLink, Button, Skeleton, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errorMessage, useApiData, usePolling } from "@/lib/hooks";
import { formatRange, formatTime, sessionPhase } from "@/lib/time";
import type { CheckInWindow, ClassSession, Roster } from "@/lib/types";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useAuth();
  const session = useApiData(() => api.get<ClassSession>(`/sessions/${id}`), [api, id]);
  const canManage = user?.role === "ADMIN" || user?.role === "LECTURER";

  if (session.error) {
    return (
      <div className="space-y-4">
        <BackLink href="/dashboard">Dashboard</BackLink>
        <Alert>{session.error.message === "Session not found" ? "This session doesn't exist, or you don't have access to it." : errorMessage(session.error)}</Alert>
      </div>
    );
  }
  if (!session.data) return <Skeleton className="h-40" />;
  const s = session.data;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <BackLink href={`/courses/${s.courseId}`}>
          {s.course.code} {s.course.title}
        </BackLink>
        <h1 className="text-2xl font-semibold">{formatRange(s.startsAt, s.endsAt)}</h1>
        <p className="text-muted">{s.venue}</p>
      </div>

      {canManage ? (
        <ManageAttendance session={s} />
      ) : (
        <Alert tone="info">When your lecturer opens check-in, scan the QR code on their screen with your phone camera.</Alert>
      )}
    </div>
  );
}

function ManageAttendance({ session }: { session: ClassSession }) {
  const { api } = useAuth();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState(15);
  const [lateAfter, setLateAfter] = useState(10);

  const loadRoster = useCallback(async () => {
    try {
      setRoster(await api.get<Roster>(`/sessions/${session.id}/attendance`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, session.id]);

  const open = roster?.session.checkInOpen ?? false;
  // Refresh the roster every 4 seconds while students are checking in, otherwise every 30.
  usePolling(loadRoster, open ? 4000 : 30000);

  const phase = sessionPhase(session);

  async function act(fn: () => Promise<unknown>, message?: (r: unknown) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (message) setNotice(message(result));
      await loadRoster();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const openCheckIn = () =>
    act(
      () => api.post<CheckInWindow>(`/sessions/${session.id}/check-in/open`, { durationMinutes: duration, lateAfterMinutes: lateAfter }),
      (r) => `Check-in open until ${formatTime((r as CheckInWindow).checkInClosesAt)}. Late after ${formatTime((r as CheckInWindow).lateAfter)}.`,
    );
  const closeCheckIn = () => act(() => api.post(`/sessions/${session.id}/check-in/close`), () => "Check-in closed.");
  const markAbsent = () =>
    act(
      () => api.post<{ markedAbsent: number }>(`/sessions/${session.id}/attendance/mark-absent`),
      (r) => {
        const n = (r as { markedAbsent: number }).markedAbsent;
        return n === 0 ? "Everyone already has a record." : `${n} ${n === 1 ? "student" : "students"} marked absent.`;
      },
    );
  const onQrClosed = useCallback(() => void loadRoster(), [loadRoster]);

  const select = "rounded-md border border-line bg-surface px-2 py-1.5 text-sm";

  return (
    <div className="space-y-8">
      <section aria-labelledby="checkin-heading" className="space-y-3">
        <h2 id="checkin-heading" className="text-lg font-semibold">
          Check-in
        </h2>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="info">{notice}</Alert>}

        {!roster && !error && <Skeleton className="h-24" />}

        {roster && open && (
          <div className="space-y-3">
            <QrDisplay sessionId={session.id} courseCode={session.course.code} onClosed={onQrClosed} />
            <div className="flex justify-center">
              <Button variant="danger" onClick={closeCheckIn} disabled={busy}>
                Close check-in
              </Button>
            </div>
          </div>
        )}

        {roster && !open && phase !== "ended" && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Open for</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={select}>
                {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Late after</span>
              <select value={lateAfter} onChange={(e) => setLateAfter(Number(e.target.value))} className={select}>
                {[0, 5, 10, 15, 20, 30].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "the start time" : `${m} minutes`}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={openCheckIn} disabled={busy}>
              {busy ? "Opening…" : "Open check-in"}
            </Button>
            {phase === "upcoming" && <p className="w-full text-xs text-muted">This session hasn&apos;t started yet. Students can still check in early.</p>}
          </div>
        )}

        {roster && !open && phase === "ended" && <p className="text-sm text-muted">This session has ended, so check-in can&apos;t be opened.</p>}
      </section>

      <section aria-labelledby="roster-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="roster-heading" className="text-lg font-semibold">
            Attendance
          </h2>
          {roster && <RosterSummary summary={roster.summary} />}
        </div>

        {roster && roster.items.length === 0 && <p className="text-muted">No students are enrolled in this course yet.</p>}

        {roster && roster.items.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Student
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Number
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Recorded
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {roster.items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      {r.user.firstName} {r.user.lastName}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-muted">{r.studentNumber}</td>
                    <td className="px-4 py-2">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {r.recordedAt ? `${formatTime(r.recordedAt)}${r.method === "MANUAL" ? " · by hand" : " · QR"}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {roster && !open && phase !== "upcoming" && roster.summary.notRecorded > 0 && (
          <Button variant="secondary" onClick={markAbsent} disabled={busy}>
            Mark the other {roster.summary.notRecorded} absent
          </Button>
        )}
      </section>
    </div>
  );
}

function RosterSummary({ summary }: { summary: Roster["summary"] }) {
  const parts = [
    [summary.present, "present"],
    [summary.late, "late"],
    [summary.absent, "absent"],
    [summary.excused, "excused"],
    [summary.notRecorded, "not yet"],
  ] as const;
  return (
    <p className="text-sm text-muted" aria-live="polite">
      {parts
        .filter(([n]) => n > 0)
        .map(([n, label]) => `${n} ${label}`)
        .join(" · ") || "No students"}{" "}
      of {summary.enrolled}
    </p>
  );
}
