"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/hooks";
import { formatTime } from "@/lib/time";
import type { QrCode } from "@/lib/types";
import { Button } from "./ui";

// The code encodes a link, so students can scan it with their normal camera app and land
// straight on the check-in page. The token inside changes every 30 seconds.
export function checkInUrl(origin: string, token: string) {
  return `${origin}/check-in?t=${encodeURIComponent(token)}`;
}

export function QrDisplay({ sessionId, courseCode, onClosed }: { sessionId: string; courseCode: string; onClosed: () => void }) {
  const { api } = useAuth();
  const [qr, setQr] = useState<QrCode | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const fetchCode = useCallback(async () => {
    try {
      const next = await api.get<QrCode>(`/sessions/${sessionId}/check-in/qr`);
      setQr(next);
      setSecondsLeft(next.refreshInSeconds);
      setError(null);
    } catch (e) {
      // 409: check-in closed (by time running out, or from another device)
      if ((e as { status?: number }).status === 409) onClosed();
      else setError(errorMessage(e));
    }
  }, [api, sessionId, onClosed]);

  // Fetch now, then again whenever the current code is about to change (and every 5 s
  // anyway, to keep the checked-in count fresh).
  useEffect(() => {
    void fetchCode();
  }, [fetchCode]);
  useEffect(() => {
    if (!qr) return;
    const wait = Math.min(qr.refreshInSeconds * 1000 + 250, 5000);
    const t = setTimeout(fetchCode, wait);
    return () => clearTimeout(t);
  }, [qr, fetchCode]);

  // Countdown shown under the code.
  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // Redraw only when the token itself changes.
  const token = qr?.token;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    QRCode.toString(checkInUrl(window.location.origin, token), { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((s) => !cancelled && setSvg(s))
      .catch(() => !cancelled && setError("Couldn't draw the QR code."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : panel.current?.requestFullscreen());

  return (
    <div
      ref={panel}
      className={
        fullscreen
          ? "flex h-full flex-col items-center justify-center gap-6 bg-white p-8"
          : "flex flex-col items-center gap-4 rounded-xl border border-line bg-surface p-6"
      }
    >
      <div className="text-center">
        <div className={`font-semibold uppercase tracking-wide text-brand ${fullscreen ? "text-3xl" : "text-sm"}`}>{courseCode}</div>
        <div className={fullscreen ? "mt-2 text-2xl" : "text-sm text-muted"}>Scan with your phone camera to check in</div>
      </div>

      <div
        className={fullscreen ? "aspect-square w-[min(70vh,80vw)]" : "aspect-square w-64 max-w-full"}
        role="img"
        aria-label={`Check-in QR code for ${courseCode}. It changes every 30 seconds.`}
        // The SVG comes from the qrcode library, built from our own token.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      {qr && (
        <div className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-1 ${fullscreen ? "text-xl" : "text-sm"}`}>
          <span>
            <strong className="tabular-nums">{qr.checkedIn}</strong> checked in
          </span>
          <span className="text-muted">
            New code in <span className="tabular-nums">{secondsLeft}</span>s
          </span>
          <span className="text-muted">Closes {formatTime(qr.closesAt)}</span>
        </div>
      )}

      <Button variant="secondary" onClick={toggleFullscreen}>
        {fullscreen ? "Exit full screen" : "Full screen"}
      </Button>
    </div>
  );
}
