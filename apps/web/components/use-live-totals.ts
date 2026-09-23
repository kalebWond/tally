'use client';

import { LiveMessage, STALE_AFTER_MS } from '@tally/contracts';
import { useEffect, useState } from 'react';
import { afterClose } from '@/lib/reconnect';
import { applyFrame, emptyTotals, type Totals } from '@/lib/standings';

export type ConnectionState =
  /** First connection, nothing received yet. */
  | 'connecting'
  /** Snapshot received; frames flowing. */
  | 'live'
  /** Lost the gateway; waiting out a backoff before the next attempt. */
  | 'reconnecting'
  /** The browser has no network; reconnects as soon as it does. */
  | 'offline'
  /** The gateway refused this contest (4400). Retrying can't help. */
  | 'unavailable';

/** A socket that never closed cleanly: crash, network drop, or silence past STALE_AFTER_MS. */
const ABNORMAL_CLOSE = 1006;

/**
 * Subscribes to the gateway's /live feed for one contest and keeps it alive: reconnects with
 * jittered backoff (never giving up), treats STALE_AFTER_MS of silence as a dead connection
 * (the gateway heartbeats every 15 s), and pauses while the browser is offline. Every
 * (re)connection begins with a fresh snapshot, which replaces the totals wholesale, so the
 * page resyncs without a refresh and counters spring to the corrected values.
 */
export function useLiveTotals(gatewayUrl: string, contestId: string) {
  const [totals, setTotals] = useState<Totals>(emptyTotals);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  /** False until the first snapshot: totals are unknown, not zero. */
  const [synced, setSynced] = useState(false);
  /** When the next reconnect attempt fires (epoch ms), for the "reconnecting in 4s" note. */
  const [retryAt, setRetryAt] = useState<number | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let attempt = 0;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;

    const armStaleTimer = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => drop(ABNORMAL_CLOSE), STALE_AFTER_MS);
    };

    /** The current socket is gone (or presumed dead): detach it and plan the next attempt. */
    function drop(code: number) {
      if (socket) {
        socket.onmessage = socket.onclose = null;
        socket.close();
        socket = null;
      }
      clearTimeout(staleTimer);
      if (disposed) return;

      if (!navigator.onLine) {
        setConnection('offline');
        setRetryAt(null);
        return; // the 'online' listener reconnects
      }
      const plan = afterClose(code, attempt);
      if (!plan.retry) {
        setConnection('unavailable');
        setRetryAt(null);
        return;
      }
      attempt++;
      setConnection('reconnecting');
      setRetryAt(Date.now() + plan.delayMs);
      retryTimer = setTimeout(connect, plan.delayMs);
    }

    function connect() {
      clearTimeout(retryTimer);
      setRetryAt(null);
      const url = new URL('/live', gatewayUrl);
      url.searchParams.set('contestId', contestId);
      const ws = new WebSocket(url);
      socket = ws;
      armStaleTimer();

      ws.onmessage = (event) => {
        armStaleTimer(); // any frame, heartbeats included, proves the connection is alive
        const frame = LiveMessage.safeParse(JSON.parse(String(event.data)));
        if (!frame.success) return;
        if (frame.data.type === 'snapshot') {
          attempt = 0; // only a snapshot counts as recovered, not merely an open socket
          setSynced(true);
          setConnection('live');
        }
        setTotals((state) => applyFrame(state, frame.data));
      };
      ws.onclose = (event) => {
        if (socket === ws) drop(event.code);
      };
    }

    const onOffline = () => drop(ABNORMAL_CLOSE);
    const onOnline = () => {
      if (socket) return;
      attempt = 0;
      connect();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      drop(1000);
    };
  }, [gatewayUrl, contestId]);

  return { ...totals, connection, synced, retryAt };
}
