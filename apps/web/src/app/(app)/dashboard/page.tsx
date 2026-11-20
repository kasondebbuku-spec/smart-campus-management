"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Course = {
  id: string;
  code: string;
  title: string;
  semester: string;
  lecturer: { user: { firstName: string; lastName: string } } | null;
  _count: { enrolments: number };
};

const INTRO = {
  ADMIN: { heading: "All courses", empty: "No courses yet. Create one through the API docs at /api/docs." },
  LECTURER: { heading: "Courses you teach", empty: "You aren't assigned to any courses yet. Ask an administrator to add you." },
  STUDENT: { heading: "Your courses", empty: "You aren't enrolled in any courses yet." },
} as const;

export default function DashboardPage() {
  const { user, api } = useAuth();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: Course[] }>("/courses")
      .then((res) => !cancelled && setCourses(res.items))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Can't reach the server."));
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!user) return null;
  const intro = INTRO[user.role];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Welcome, {user.firstName}</h1>
        <p className="mt-1 text-muted">
          {user.role === "STUDENT" && "Check in to class by scanning the code on the lecturer's screen."}
          {user.role === "LECTURER" && "Schedule sessions, run QR check-in and keep attendance up to date."}
          {user.role === "ADMIN" && "Manage accounts, courses and enrolment across the department."}
        </p>
      </section>

      <section aria-labelledby="courses-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="courses-heading" className="text-lg font-semibold">
            {intro.heading}
          </h2>
          {courses && <span className="text-sm text-muted">{courses.length} total</span>}
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {!courses && !error && (
          <ul className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading courses">
            {[0, 1].map((i) => (
              <li key={i} className="h-28 animate-pulse rounded-xl border border-line bg-surface" />
            ))}
          </ul>
        )}

        {courses?.length === 0 && <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">{intro.empty}</p>}

        {courses && courses.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {courses.map((c) => (
              <li key={c.id}>
                <Link href={`/courses/${c.id}`} className="block rounded-xl border border-line bg-surface p-4 shadow-sm transition hover:border-brand">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand">{c.code}</div>
                    <div className="mt-0.5 font-medium">{c.title}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">{c.semester}</span>
                </div>
                <dl className="mt-3 flex gap-4 text-sm text-muted">
                  <div>
                    <dt className="sr-only">Lecturer</dt>
                    <dd>{c.lecturer ? `${c.lecturer.user.firstName} ${c.lecturer.user.lastName}` : "No lecturer assigned"}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">Students</dt>
                    <dd>
                      {c._count.enrolments} {c._count.enrolments === 1 ? "student" : "students"}
                    </dd>
                  </div>
                </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
