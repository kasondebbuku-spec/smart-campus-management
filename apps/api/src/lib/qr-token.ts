import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

// Check-in QR codes change every 30 seconds. Each code is
//   <sessionId>.<window>.<signature>
// where window = number of 30-second periods since 1970 and the signature is an HMAC
// over the session id and window. Nothing is stored: the server can recompute and
// check any code. A code is accepted during its own window and the next one, so a
// student who scans just before it changes still gets in, but a photo forwarded to
// someone at home stops working within a minute.

export const QR_WINDOW_SECONDS = 30;
const ACCEPTED_PAST_WINDOWS = 1;

// A separate key from the one that signs access tokens, derived from the same secret.
const key = createHash("sha256").update(`${config.JWT_ACCESS_SECRET}:check-in-qr`).digest();

const windowAt = (ms: number) => Math.floor(ms / (QR_WINDOW_SECONDS * 1000));

function sign(sessionId: string, window: number): string {
  return createHmac("sha256", key).update(`${sessionId}.${window}`).digest("base64url").slice(0, 22);
}

export function currentQrToken(sessionId: string, now = Date.now()) {
  const window = windowAt(now);
  const nextChangeMs = (window + 1) * QR_WINDOW_SECONDS * 1000;
  return {
    token: `${sessionId}.${window}.${sign(sessionId, window)}`,
    refreshInSeconds: Math.ceil((nextChangeMs - now) / 1000),
  };
}

export type QrCheck = { ok: true; sessionId: string } | { ok: false; reason: "malformed" | "invalid" | "expired" };

export function verifyQrToken(token: string, now = Date.now()): QrCheck {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [sessionId, windowText, signature] = parts as [string, string, string];
  const window = Number(windowText);
  if (!sessionId || !Number.isInteger(window)) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(sign(sessionId, window));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };

  const current = windowAt(now);
  if (window > current || window < current - ACCEPTED_PAST_WINDOWS) return { ok: false, reason: "expired" };
  return { ok: true, sessionId };
}
