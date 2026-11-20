import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type Session } from "../src/lib/api";

const user = { id: "u1", email: "a@campus.test", role: "LECTURER" as const, firstName: "Mutale", lastName: "Phiri" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const session = (token: string) => json(200, { accessToken: token, user });

// A fake API: give it a function that answers each (method, path, auth header).
function fakeFetch(handler: (method: string, path: string, auth: string | null) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("Authorization");
    return handler(init?.method ?? "GET", String(url).replace("/api/v1", ""), auth);
  });
}

describe("API client", () => {
  it("signs in and sends the access token on later requests", async () => {
    const fetch = fakeFetch((method, path, auth) => {
      if (path === "/auth/login") return session("token-1");
      if (path === "/courses") return json(200, { items: [], seenAuth: auth });
      return json(404, {});
    });
    const api = createApiClient({ fetch });

    await api.login("a@campus.test", "pw");
    const res = await api.get<{ seenAuth: string }>("/courses");
    expect(res.seenAuth).toBe("Bearer token-1");
  });

  it("refreshes an expired access token and retries the request once", async () => {
    const fetch = fakeFetch((method, path, auth) => {
      if (path === "/auth/login") return session("old");
      if (path === "/auth/refresh") return session("new");
      if (path === "/courses") return auth === "Bearer new" ? json(200, { ok: true }) : json(401, { error: { code: "unauthorized", message: "expired" } });
      return json(404, {});
    });
    const api = createApiClient({ fetch });
    await api.login("a@campus.test", "pw");

    expect(await api.get("/courses")).toEqual({ ok: true });
    expect(api.session?.accessToken).toBe("new");
  });

  it("shares one refresh between many requests that expire together", async () => {
    let refreshes = 0;
    const fetch = fakeFetch(async (method, path, auth) => {
      if (path === "/auth/login") return session("old");
      if (path === "/auth/refresh") {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return session("new");
      }
      return auth === "Bearer new" ? json(200, { path }) : json(401, { error: { code: "unauthorized", message: "expired" } });
    });
    const api = createApiClient({ fetch });
    await api.login("a@campus.test", "pw");

    await Promise.all(["/a", "/b", "/c", "/d"].map((p) => api.get(p)));
    expect(refreshes).toBe(1);
  });

  it("retries once when another tab refreshed at the same moment", async () => {
    let calls = 0;
    const fetch = fakeFetch((method, path) => {
      if (path === "/auth/refresh") return ++calls === 1 ? json(409, { error: { code: "refresh_race", message: "retry" } }) : session("new");
      return json(404, {});
    });
    const api = createApiClient({ fetch, raceRetryMs: 1 });

    const s = await api.refresh();
    expect(s?.accessToken).toBe("new");
    expect(calls).toBe(2);
  });

  it("ends the session when refreshing fails, and reports the original error", async () => {
    const changes: (Session | null)[] = [];
    const fetch = fakeFetch((method, path) => {
      if (path === "/auth/login") return session("old");
      if (path === "/auth/refresh") return json(401, { error: { code: "unauthorized", message: "Session expired" } });
      return json(401, { error: { code: "unauthorized", message: "Authentication required" } });
    });
    const api = createApiClient({ fetch, onSession: (s) => changes.push(s) });
    await api.login("a@campus.test", "pw");

    await expect(api.get("/courses")).rejects.toMatchObject({ status: 401 });
    expect(api.session).toBeNull();
    expect(changes.at(-1)).toBeNull();
  });

  it("doesn't try to refresh when the sign-in itself fails", async () => {
    const fetch = fakeFetch((method, path) => {
      if (path === "/auth/login") return json(401, { error: { code: "unauthorized", message: "Invalid email or password" } });
      return session("should-not-happen");
    });
    const api = createApiClient({ fetch });

    await expect(api.login("a@campus.test", "wrong")).rejects.toThrow("Invalid email or password");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("turns API errors into ApiError with field details", async () => {
    const fetch = fakeFetch(() =>
      json(400, { error: { code: "validation_error", message: "Some fields are missing or invalid", details: [{ path: "email", message: "Invalid email" }] } }),
    );
    const api = createApiClient({ fetch });

    const err = await api.post("/users", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "validation_error", details: [{ path: "email", message: "Invalid email" }] });
  });

  it("clears the session on sign-out even if the network fails", async () => {
    const fetch = fakeFetch((method, path) => {
      if (path === "/auth/login") return session("t");
      throw new TypeError("Failed to fetch");
    });
    const api = createApiClient({ fetch });
    await api.login("a@campus.test", "pw");

    await expect(api.logout()).rejects.toThrow();
    expect(api.session).toBeNull();
  });
});
