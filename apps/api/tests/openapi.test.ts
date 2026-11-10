import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openApiSpec } from "../src/openapi/spec.js";

// Where each router is mounted in src/app.ts.
const MOUNTS: Record<string, string> = {
  "modules/auth/auth.routes.ts": "/api/v1/auth",
  "modules/users/users.routes.ts": "/api/v1/users",
  "modules/courses/courses.routes.ts": "/api/v1/courses",
  "modules/sessions/sessions.routes.ts": "/api/v1",
  "modules/attendance/attendance.routes.ts": "/api/v1",
};

const src = (file: string) => readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");

// Reads routes straight from the source, e.g. router.post("/:id/enrolments", ...)
// becomes "post /api/v1/courses/{id}/enrolments".
function routesInCode(): string[] {
  const routes = ["get /health"];
  for (const [file, prefix] of Object.entries(MOUNTS)) {
    for (const m of src(file).matchAll(/\b\w*[rR]outer\.(get|post|put|patch|delete)\("([^"]+)"/g)) {
      const path = (prefix + (m[2] === "/" ? "" : m[2])).replace(/:(\w+)/g, "{$1}");
      routes.push(`${m[1]} ${path}`);
    }
  }
  return routes.sort();
}

const METHODS = ["get", "post", "put", "patch", "delete"];
type Operation = { parameters?: { name: string; in: string }[]; responses?: Record<string, unknown> };
const paths = openApiSpec.paths as unknown as Record<string, Record<string, Operation>>;

function routesInSpec(): string[] {
  return Object.entries(paths)
    .flatMap(([path, ops]) => Object.keys(ops).filter((m) => METHODS.includes(m)).map((m) => `${m} ${path}`))
    .sort();
}

describe("OpenAPI specification", () => {
  it("found the routes (sanity check on the parser)", () => {
    expect(routesInCode().length).toBeGreaterThan(20);
  });

  it("documents every route in the code, and nothing that doesn't exist", () => {
    expect(routesInSpec()).toEqual(routesInCode());
  });

  it("declares every path parameter", () => {
    for (const [path, ops] of Object.entries(paths)) {
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const [method, op] of Object.entries(ops)) {
        const declared = (op.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name).sort();
        expect(declared, `${method.toUpperCase()} ${path}`).toEqual(inPath);
      }
    }
  });

  it("gives every operation at least one success response", () => {
    for (const [path, ops] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const codes = Object.keys(op.responses ?? {});
        expect(codes.some((c) => c.startsWith("2")), `${method.toUpperCase()} ${path}`).toBe(true);
      }
    }
  });

  it("has no broken $ref links", () => {
    const schemas = openApiSpec.components.schemas as Record<string, unknown>;
    const refs = [...JSON.stringify(openApiSpec).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const name of new Set(refs)) expect(schemas, `missing schema ${name}`).toHaveProperty(name);
  });
});

describe("docs endpoints", () => {
  const app = createApp();

  it("serves the specification as JSON", async () => {
    const res = await request(app).get("/api/docs/openapi.json").expect(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths)).toContain("/api/v1/check-in");
  });

  it("serves the interactive page with a nonce-based Content-Security-Policy", async () => {
    const res = await request(app).get("/api/docs").expect(200);
    expect(res.type).toBe("text/html");

    const csp = res.headers["content-security-policy"] as string;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeDefined();
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("allows the Swagger files the page actually loads", async () => {
    const res = await request(app).get("/api/docs").expect(200);
    const csp = res.headers["content-security-policy"] as string;
    const allowed = (directive: string) => (csp.split("; ").find((d) => d.startsWith(directive)) ?? "").split(" ").slice(1);

    // CSP matching: a source ending in "/" covers everything under it; otherwise it must match exactly.
    const covers = (source: string, url: string) => (source.endsWith("/") ? url.startsWith(source) : url === source);
    const scripts = [...res.text.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]!);
    const styles = [...res.text.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]!);

    expect(scripts.length).toBeGreaterThan(0);
    for (const url of scripts) expect(allowed("script-src").some((s) => covers(s, url)), url).toBe(true);
    for (const url of styles) expect(allowed("style-src").some((s) => covers(s, url)), url).toBe(true);
  });

  it("uses a fresh nonce on every request", async () => {
    const a = (await request(app).get("/api/docs")).headers["content-security-policy"];
    const b = (await request(app).get("/api/docs")).headers["content-security-policy"];
    expect(a).not.toBe(b);
  });

  it("keeps the strict policy on the rest of the API", async () => {
    const res = await request(app).get("/api/v1/courses");
    expect(res.headers["content-security-policy"]).not.toContain("cdn.jsdelivr.net");
  });
});
