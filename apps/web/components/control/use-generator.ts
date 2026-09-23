'use client';

import { ErrorResponse, GeneratorStatus } from '@tally/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addSample, type RatePoint, type RateSample } from '@/lib/rate-history';

export const POLL_MS = 1000;

type Action = 'start' | 'rate' | 'burst' | 'stop';

/**
 * Polls the generator's status through the web app's control API (never the generator itself)
 * and keeps a minute of throughput history for the chart. Control calls answer with the new
 * status, which is shown at once rather than waiting for the next poll.
 */
export function useGenerator() {
  const [status, setStatus] = useState<GeneratorStatus | null>(null);
  /** False while the generator (or the web app) isn't answering. */
  const [reachable, setReachable] = useState(true);
  const [history, setHistory] = useState<RatePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const last = useRef<RateSample | undefined>(undefined);

  const accept = useCallback((next: GeneratorStatus) => {
    const sample: RateSample = {
      at: Date.now(),
      sentTotal: next.sentTotal,
      startedAt: next.startedAt,
      currentRate: next.currentRate,
    };
    // Captured now: React may run the updater after last.current has moved on.
    const prev = last.current;
    last.current = sample;
    setStatus(next);
    setReachable(true);
    setHistory((points) => addSample(points, prev, sample));
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/generator/status', { cache: 'no-store' });
        if (res.status === 401) return signIn();
        const body = GeneratorStatus.safeParse(await res.json());
        if (res.ok && body.success) accept(body.data);
        else setReachable(false);
      } catch {
        setReachable(false);
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [accept]);

  const act = useCallback(
    async (action: Action, body?: unknown) => {
      setBusy(action);
      setError(null);
      try {
        const res = await fetch(`/api/generator/${action}`, {
          method: 'POST',
          ...(body !== undefined && {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        });
        if (res.status === 401) return signIn();
        const json: unknown = await res.json();
        const ok = GeneratorStatus.safeParse(json);
        if (res.ok && ok.success) return accept(ok.data);
        const failure = ErrorResponse.safeParse(json);
        setError(
          failure.success ? describe(failure.data) : `The request failed (HTTP ${res.status}).`,
        );
      } catch {
        setError('Could not reach the web server.');
      } finally {
        setBusy(null);
      }
    },
    [accept],
  );

  return { status, reachable, history, error, busy, act };
}

function describe({ issues, error }: ErrorResponse) {
  if (issues.length === 0) return error.replaceAll('_', ' ');
  return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' ');
}

function signIn() {
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
}
