'use client';

import { LiveMessage } from '@tally/contracts';
import { useEffect, useState } from 'react';
import { applyFrame, emptyTotals, type Totals } from '@/lib/standings';

export type ConnectionState = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the gateway's /live feed for one contest. Every frame is merged into a new
 * Totals object; frames that don't match the contract are ignored rather than crashing the page.
 * Reconnect with backoff and resync arrive in F11.
 */
export function useLiveTotals(gatewayUrl: string, contestId: string) {
  const [totals, setTotals] = useState<Totals>(emptyTotals);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  /** False until the first snapshot: totals are unknown, not zero. */
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const url = new URL('/live', gatewayUrl);
    url.searchParams.set('contestId', contestId);
    const ws = new WebSocket(url);
    setConnection('connecting');

    ws.onopen = () => setConnection('live');
    ws.onclose = () => setConnection('offline');
    ws.onmessage = (event) => {
      const frame = LiveMessage.safeParse(JSON.parse(String(event.data)));
      if (!frame.success) return;
      if (frame.data.type === 'snapshot') setSynced(true);
      setTotals((state) => applyFrame(state, frame.data));
    };
    return () => ws.close();
  }, [gatewayUrl, contestId]);

  return { ...totals, connection, synced };
}
