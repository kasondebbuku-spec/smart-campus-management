"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/** Runs `fn` now and then every `ms` while `enabled`, and pauses while the tab is hidden. */
export function usePolling(fn: () => unknown, ms: number, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      void saved.current();
      timer = setInterval(() => void saved.current(), ms);
    };
    const stop = () => clearInterval(timer);
    const onVisibility = () => (document.hidden ? stop() : (stop(), start()));

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}

/** Loads data once (and on demand with `reload`), tracking loading and error state. */
export function useApiData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [version, setVersion] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableLoad = useCallback(load, deps);

  useEffect(() => {
    let cancelled = false;
    stableLoad()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [stableLoad, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, setData };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Can't reach the server. Check your connection and try again.";
}
