import { describe, expect, it } from "vitest";
import { currentQrToken, verifyQrToken } from "../src/lib/qr-token.js";

const T0 = Date.UTC(2026, 10, 9, 6, 0, 0); // a moment exactly on a 30-second boundary
const sec = (n: number) => n * 1000;

describe("check-in QR tokens", () => {
  it("are accepted straight away and name the session", () => {
    const { token } = currentQrToken("session_1", T0);
    expect(verifyQrToken(token, T0)).toEqual({ ok: true, sessionId: "session_1" });
  });

  it("change every 30 seconds", () => {
    expect(currentQrToken("s", T0).token).toBe(currentQrToken("s", T0 + sec(29)).token);
    expect(currentQrToken("s", T0).token).not.toBe(currentQrToken("s", T0 + sec(30)).token);
  });

  it("say how long until the next change", () => {
    expect(currentQrToken("s", T0).refreshInSeconds).toBe(30);
    expect(currentQrToken("s", T0 + sec(25)).refreshInSeconds).toBe(5);
  });

  it("are still accepted for one more period, so a scan just before a change works", () => {
    const { token } = currentQrToken("s", T0 + sec(29));
    expect(verifyQrToken(token, T0 + sec(31)).ok).toBe(true);
    expect(verifyQrToken(token, T0 + sec(59)).ok).toBe(true);
  });

  it("expire after that, so a forwarded photo stops working within a minute", () => {
    const { token } = currentQrToken("s", T0);
    expect(verifyQrToken(token, T0 + sec(60))).toEqual({ ok: false, reason: "expired" });
  });

  it("can't be made ahead of time", () => {
    const { token } = currentQrToken("s", T0 + sec(60));
    expect(verifyQrToken(token, T0)).toEqual({ ok: false, reason: "expired" });
  });

  it("reject a signature copied onto another session", () => {
    const [, window, signature] = currentQrToken("session_1", T0).token.split(".");
    expect(verifyQrToken(`session_2.${window}.${signature}`, T0)).toEqual({ ok: false, reason: "invalid" });
  });

  it("reject an edited time window", () => {
    const [id, window, signature] = currentQrToken("s", T0).token.split(".");
    expect(verifyQrToken(`${id}.${Number(window) + 1}.${signature}`, T0 + sec(30))).toEqual({ ok: false, reason: "invalid" });
  });

  it.each(["", "abc", "a.b", "a.notanumber.sig", "a.1.2.3"])("reject malformed input %j", (token) => {
    expect(verifyQrToken(token, T0)).toEqual({ ok: false, reason: "malformed" });
  });
});
