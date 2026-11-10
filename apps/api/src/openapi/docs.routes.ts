import { randomBytes } from "node:crypto";
import { Router } from "express";
import { openApiSpec } from "./spec.js";

// Swagger UI is loaded from a pinned CDN version, so the API needs no extra packages.
const SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

export const docsRouter = Router();

docsRouter.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

docsRouter.get("/", (_req, res) => {
  // The rest of the API sends a strict Content-Security-Policy. This page relaxes it just
  // enough for Swagger UI: its files from the CDN, and one inline script marked with a nonce.
  const nonce = randomBytes(16).toString("base64");
  // The trailing slash matters: without it, a CSP source allows only that exact URL,
  // not the files inside the folder.
  const cdn = `${SWAGGER}/`;
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' ${cdn} 'nonce-${nonce}'`,
      `style-src 'self' ${cdn} 'unsafe-inline'`,
      `img-src 'self' data: ${cdn}`,
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Smart Campus API</title>
  <link rel="stylesheet" href="${SWAGGER}/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER}/swagger-ui-bundle.js"></script>
  <script nonce="${nonce}">
    SwaggerUIBundle({
      url: "/api/docs/openapi.json",
      dom_id: "#swagger-ui",
      persistAuthorization: true,
      withCredentials: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`);
});
