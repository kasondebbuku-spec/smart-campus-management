// Where to go after signing in. Only paths on this site are allowed, so a link like
// /login?next=https://evil.example can't send someone to another website (open redirect).
// Browsers treat "//host" and "/\host" as links to another site, so those are refused too.
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  if (next.startsWith("/login")) return fallback; // avoid bouncing back to the login page
  return next;
}
