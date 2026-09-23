import { createServer } from 'node:http';
import {
  ContestStatus,
  HEARTBEAT_MS,
  type HealthResponse,
  LiveCloseCodes,
  type LiveHeartbeat,
  type LiveSnapshot,
  type LiveUpdate,
  MINUTES_WINDOW,
  redisKeys,
} from '@tally/contracts';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { debugPage } from './debug-page.js';
import { diffMinutes, diffTotals } from './diff.js';

interface GatewayOptions {
  redis: Redis;
  /** How often each watched contest's totals are read from Redis. */
  pollMs: number;
  log: Logger;
  /** Dead-connection sweep interval (WebSocket ping/pong). */
  heartbeatMs?: number;
  /** App-level heartbeat frame interval, so browsers can detect a silently dead connection. */
  heartbeatFrameMs?: number;
}

/** One per contest with at least one viewer: a single Redis poll fanned out to every client. */
interface Room {
  contestId: string;
  clients: Set<WebSocket>;
  /** Joins still waiting for the first read; the room must not be torn down under them. */
  pending: number;
  last: Map<string, number>;
  totalVotes: number;
  status: ContestStatus | null;
  /** Per-minute counts in the current window, and the window's last minute (F17). */
  minutes: Map<number, number>;
  minutesTo: number;
  ready: Promise<void>;
  timer?: NodeJS.Timeout;
  closed: boolean;
}

const ContestId = z.uuid();

export function createGateway({
  redis,
  pollMs,
  log,
  heartbeatMs = 30_000,
  heartbeatFrameMs = HEARTBEAT_MS,
}: GatewayOptions) {
  const rooms = new Map<string, Room>();
  const alive = new WeakMap<WebSocket, boolean>();

  async function read(contestId: string) {
    const [totals, [totalVotes, status, lastMinute]] = await Promise.all([
      redis.hgetall(redisKeys.totals(contestId)),
      redis.hmget(redisKeys.meta(contestId), 'totalVotes', 'status', 'lastMinute'),
    ]);
    const map = new Map(Object.entries(totals).map(([id, v]) => [id, Number(v)]));
    const sum = [...map.values()].reduce((s, v) => s + v, 0);
    const known = ContestStatus.safeParse(status);

    // The chart window: the last MINUTES_WINDOW minutes, ending now, or for a closed contest at
    // its last minute with votes, so its chart doesn't scroll away. Only those fields are read.
    const nowMinute = Math.floor(Date.now() / 60_000) * 60_000;
    const minutesTo =
      known.data === 'closed' && lastMinute != null ? Number(lastMinute) : nowMinute;
    const window = Array.from(
      { length: MINUTES_WINDOW },
      (_, i) => minutesTo - (MINUTES_WINDOW - 1 - i) * 60_000,
    );
    const counts = await redis.hmget(redisKeys.minutes(contestId), ...window.map(String));
    const minutes = new Map<number, number>();
    window.forEach((minute, i) => {
      const count = counts[i];
      if (count != null) minutes.set(minute, Number(count));
    });

    return {
      totals: map,
      totalVotes: totalVotes == null ? sum : Number(totalVotes),
      status: known.success ? known.data : null,
      minutes,
      minutesTo,
    };
  }

  function broadcast(room: Room, message: LiveUpdate) {
    const data = JSON.stringify(message);
    for (const ws of room.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  function schedulePoll(room: Room) {
    room.timer = setTimeout(async () => {
      if (room.closed) return;
      try {
        const next = await read(room.contestId);
        if (room.closed) return;
        const changed = diffTotals(room.last, next.totals);
        const totalsMoved = next.totalVotes !== room.totalVotes;
        const statusMoved = next.status !== room.status;
        const minutesChanged = diffMinutes(room.minutes, next.minutes);
        const windowMoved = next.minutesTo !== room.minutesTo;
        // Assign and broadcast together, with no await in between: every client's state is
        // always "snapshot + the updates computed after it".
        room.last = next.totals;
        room.totalVotes = next.totalVotes;
        room.status = next.status;
        room.minutes = next.minutes;
        room.minutesTo = next.minutesTo;
        if (changed.length || totalsMoved || statusMoved || minutesChanged.length || windowMoved) {
          broadcast(room, {
            type: 'update',
            contestId: room.contestId,
            changed,
            totalVotes: next.totalVotes,
            status: next.status,
            minutes: minutesChanged,
            minutesTo: next.minutesTo,
            ts: Date.now(),
          });
        }
      } catch (err) {
        // Redis blip: clients keep their last state; the next successful poll catches up.
        log.warn({ err, contestId: room.contestId }, 'poll failed');
      }
      schedulePoll(room);
    }, pollMs);
  }

  function openRoom(contestId: string): Room {
    const room: Room = {
      contestId,
      clients: new Set(),
      pending: 0,
      last: new Map(),
      totalVotes: 0,
      status: null,
      minutes: new Map(),
      minutesTo: 0,
      ready: Promise.resolve(),
      closed: false,
    };
    room.ready = read(contestId).then((first) => {
      room.last = first.totals;
      room.totalVotes = first.totalVotes;
      room.status = first.status;
      room.minutes = first.minutes;
      room.minutesTo = first.minutesTo;
      schedulePoll(room);
    });
    rooms.set(contestId, room);
    return room;
  }

  function closeRoomIfEmpty(room: Room) {
    if (room.clients.size > 0 || room.pending > 0 || room.closed) return;
    room.closed = true;
    clearTimeout(room.timer);
    rooms.delete(room.contestId);
  }

  async function join(contestId: string, ws: WebSocket) {
    const room = rooms.get(contestId) ?? openRoom(contestId);
    room.pending++;
    try {
      await room.ready;
    } catch (err) {
      log.error({ err, contestId }, 'initial read failed');
      ws.close(1011, 'totals unavailable, retry');
      room.pending--;
      room.closed = true;
      rooms.delete(contestId); // the next join starts a fresh read
      return;
    }
    room.pending--;
    if (ws.readyState !== ws.OPEN) return closeRoomIfEmpty(room);

    // Snapshot first, then join the broadcast set, synchronously: no update can slip in between.
    const snapshot: LiveSnapshot = {
      type: 'snapshot',
      contestId,
      totals: [...room.last].map(([contestantId, total]) => ({ contestantId, total })),
      totalVotes: room.totalVotes,
      status: room.status,
      minutes: [...room.minutes].map(([minute, count]) => ({ minute, count })),
      minutesTo: room.minutesTo,
      ts: Date.now(),
    };
    ws.send(JSON.stringify(snapshot));
    room.clients.add(ws);
    ws.on('close', () => {
      room.clients.delete(ws);
      closeRoomIfEmpty(room);
    });
  }

  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') {
      const ok = await Promise.race([
        redis.ping().then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((r) => setTimeout(r, 1000, false).unref()),
      ]);
      const body: HealthResponse = {
        status: ok ? 'ok' : 'degraded',
        service: 'gateway',
        redis: ok ? 'connected' : 'disconnected',
      };
      res
        .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
      return;
    }
    if (req.method === 'GET' && path === '/debug') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(debugPage);
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/live') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      // Validate after the upgrade so the client receives a close code it can act on.
      const contestId = ContestId.safeParse(url.searchParams.get('contestId'));
      if (!contestId.success) {
        ws.close(LiveCloseCodes.invalidContest, 'contestId must be a UUID');
        return;
      }
      void join(contestId.data, ws);
    });
  });

  // Drop connections that stopped answering pings (closed laptop lids, dead proxies).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, heartbeatMs);

  // Only clients that have joined a room (i.e. already got their snapshot) receive heartbeats.
  const heartbeatFrames = setInterval(() => {
    const frame: LiveHeartbeat = { type: 'heartbeat', ts: Date.now() };
    const data = JSON.stringify(frame);
    for (const room of rooms.values()) {
      for (const ws of room.clients) if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }, heartbeatFrameMs);

  return {
    server,
    stats: () => ({
      rooms: rooms.size,
      clients: [...rooms.values()].reduce((n, r) => n + r.clients.size, 0),
    }),
    /** Close every client with 1001 so browsers reconnect elsewhere, then stop. */
    async close() {
      clearInterval(heartbeat);
      clearInterval(heartbeatFrames);
      for (const room of rooms.values()) {
        room.closed = true;
        clearTimeout(room.timer);
      }
      rooms.clear();
      for (const ws of wss.clients) ws.close(LiveCloseCodes.goingAway, 'gateway shutting down');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
