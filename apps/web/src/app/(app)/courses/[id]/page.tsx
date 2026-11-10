"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, BackLink, Button, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errorMessage, useApiData } from "@/lib/hooks";
import { formatRange, lusakaDate, relative, sessionPhase, toLusakaIso } from "@/lib/time";
import type { ClassSession, Course } from "@/lib/types";

const PHASE_STYLE = {
  upcoming: "bg-slate-100 text-slate-700",
  "in-progress": "bg-emerald-100 text-emerald-800",
  ended: "bg-slate-50 text-slate-500",
} as const;
const PHASE_LABEL = { upcoming: "Upcoming", "in-progress": "Now", ended: "Ended" } as const;

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useAuth();
  const course = useApiData(() => api.get<Course>(`/courses/${id}`), [api, id]);
  const sessions = useApiData(() => api.get<{ items: ClassSession[] }>(`/courses/${id}/sessions`), [api, id]);

  // The API decides for real; this only hides controls that would be refused.
  const canManage = user?.role === "ADMIN" || user?.role === "LECTURER";

  if (course.error) {
    return (
      <div className="space-y-4">
        <BackLink href="/dashboard">Dashboard</BackLink>
        <Alert>{course.error.message === "Course not found" ? "This course doesn't exist, or you don't have access to it." : errorMessage(course.error)}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <BackLink href="/dashboard">Dashboard</BackLink>
        {course.data ? (
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-brand">{course.data.code}</div>
            <h1 className="text-2xl font-semibold">{course.data.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {course.data.semester} ·{" "}
              {course.data.lecturer ? `${course.data.lecturer.user.firstName} ${course.data.lecturer.user.lastName}` : "No lecturer assigned"} ·{" "}
              {course.data._count.enrolments} {course.data._count.enrolments === 1 ? "student" : "students"}
            </p>
          </div>
        ) : (
          <Skeleton className="h-16" />
        )}
      </div>

      <section aria-labelledby="sessions-heading" className="space-y-3">
        <h2 id="sessions-heading" className="text-lg font-semibold">
          Sessions
        </h2>
        {sessions.error && <Alert>{errorMessage(sessions.error)}</Alert>}
        {!sessions.data && !sessions.error && <Skeleton className="h-32" />}
        {sessions.data?.items.length === 0 && (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">No sessions scheduled yet.</p>
        )}
        {sessions.data && sessions.data.items.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {sessions.data.items.map((s) => {
              const phase = sessionPhase(s);
              return (
                <li key={s.id}>
                  <Link href={`/sessions/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                    <div>
                      <div className="font-medium">{formatRange(s.startsAt, s.endsAt)}</div>
                      <div className="text-sm text-muted">
                        {s.venue}
                        {phase === "upcoming" && ` · starts ${relative(s.startsAt)}`}
                        {phase !== "upcoming" && s._count.attendance > 0 && ` · ${s._count.attendance} recorded`}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_STYLE[phase]}`}>{PHASE_LABEL[phase]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage && course.data && <ScheduleForm courseId={id} onCreated={sessions.reload} />}
    </div>
  );
}

function ScheduleForm({ courseId, onCreated }: { courseId: string; onCreated: () => void }) {
  const { api } = useAuth();
  const [date, setDate] = useState(lusakaDate());
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("10:00");
  const [venue, setVenue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await api.post(`/courses/${courseId}/sessions`, { startsAt: toLusakaIso(date, start), endsAt: toLusakaIso(date, end), venue });
      setSaved(true);
      setVenue("");
      onCreated();
    } catch (err) {
      setError(errorMessage(err)); // e.g. "LT1 is already booked for CSC3402 at that time"
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-md border border-line bg-surface px-3 py-2";
  return (
    <section aria-labelledby="schedule-heading" className="space-y-3">
      <h2 id="schedule-heading" className="text-lg font-semibold">
        Schedule a session
      </h2>
      <form onSubmit={onSubmit} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-4">
        <label className="space-y-1 text-sm sm:col-span-1">
          <span className="font-medium">Date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Starts</span>
          <input type="time" required value={start} onChange={(e) => setStart(e.target.value)} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Ends</span>
          <input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Venue</span>
          <input required minLength={2} placeholder="LT1" value={venue} onChange={(e) => setVenue(e.target.value)} className={field} />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add session"}
          </Button>
          <span className="text-xs text-muted">Times are Lusaka time.</span>
        </div>
        {error && (
          <div className="sm:col-span-4">
            <Alert>{error}</Alert>
          </div>
        )}
        {saved && (
          <div className="sm:col-span-4">
            <Alert tone="info">Session added.</Alert>
          </div>
        )}
      </form>
    </section>
  );
}
