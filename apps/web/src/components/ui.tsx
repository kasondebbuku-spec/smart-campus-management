import Link from "next/link";
import type { ReactNode } from "react";
import type { AttendanceStatus } from "@campus/shared";

export function Alert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "info" }) {
  const styles = tone === "danger" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-dark";
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ${styles}`}>
      {children}
    </p>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <span aria-hidden>←</span> {children}
    </Link>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl border border-line bg-surface ${className}`} aria-hidden />;
}

const STATUS_STYLE: Record<AttendanceStatus | "NONE", string> = {
  PRESENT: "bg-emerald-100 text-emerald-800",
  LATE: "bg-amber-100 text-amber-800",
  ABSENT: "bg-red-100 text-red-800",
  EXCUSED: "bg-sky-100 text-sky-800",
  NONE: "bg-slate-100 text-slate-600",
};
const STATUS_LABEL: Record<AttendanceStatus | "NONE", string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  EXCUSED: "Excused",
  NONE: "Not yet",
};

export function StatusPill({ status }: { status: AttendanceStatus | null }) {
  const key = status ?? "NONE";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[key]}`}>{STATUS_LABEL[key]}</span>;
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    secondary: "border border-line bg-surface hover:bg-canvas",
    danger: "border border-red-200 bg-surface text-danger hover:bg-danger-soft",
  }[variant];
  return (
    <button {...props} className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${styles} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}
