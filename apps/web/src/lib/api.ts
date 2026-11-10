import type { Role } from "@campus/shared";

export type SessionUser = { id: string; email: string; role: Role; firstName: string; lastName: string };
export type Session = { accessToken: string; user: SessionUser };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

type Options = {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called whenever the session changes: signed in, refreshed, or ended (null). */
  onSession?: (session: Session | null) => void;
  /** Wait before retrying when another tab refreshed at the same moment. */
  raceRetryMs?: number;
};

// The access token lives only in memory (never localStorage, where any script could read it).
// The refresh token is an httpOnly cookie the browser sends to /api/v1/auth automatically.
export function createApiClient({ baseUrl = "/api/v1", fetch: fetchImpl = globalThis.fetch.bind(globalThis), onSession, raceRetryMs = 300 }: Options = {}) {
  let session: Session | null = null;
  let refreshing: Promise<Session | null> | null = null;

  const setSession = (s: Session | null) => {
    session = s;
    onSession?.(s);
  };

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const e = body?.error;
      throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.details);
    }
    return body as T;
  }

  async function refreshOnce(): Promise<Session | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchImpl(`${baseUrl}/auth/refresh`, { method: "POST", credentials: "same-origin" });
      if (res.ok) {
        const s = (await res.json()) as Session;
        setSession({ accessToken: s.accessToken, user: s.user });
        return session;
      }
      // Another tab swapped the token a moment ago; the cookie jar now has the new one.
      if (res.status === 409 && attempt === 0) {
        await new Promise((r) => setTimeout(r, raceRetryMs));
        continue;
      }
      break;
    }
    setSession(null);
    return null;
  }

  // Many requests can hit an expired token at once; they share a single refresh.
  function refresh(): Promise<Session | null> {
    refreshing ??= refreshOnce().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);

    const res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, credentials: "same-origin" });

    // Access tokens last 15 minutes. When one expires, refresh once and try again.
    if (res.status === 401 && retry && !path.startsWith("/auth/")) {
      const renewed = await refresh();
      if (renewed) return request<T>(path, init, false);
    }
    return parse<T>(res);
  }

  return {
    get session() {
      return session;
    },
    refresh,
    request,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),

    async login(email: string, password: string) {
      const s = await request<Session>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);
      setSession({ accessToken: s.accessToken, user: s.user });
      return session!;
    },

    async logout() {
      try {
        await request<void>("/auth/logout", { method: "POST" }, false);
      } finally {
        setSession(null);
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
