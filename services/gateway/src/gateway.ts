import { createServer } from 'node:http';
import {
  type HealthResponse,
  LiveCloseCodes,
  type LiveSnapshot,
  type LiveUpdate,
  redisKeys,
} from '@tally/contracts';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { debugPage } from './debug-page.js';
import { diffTotals } from './diff.js';

interface GatewayOptions {
  redis: Redis;
  /** How often each watched contest's totals are read from Redis. */
  pollMs: number;
  log: Logger;
  /** Dead-connection sweep interval. */
  heartbeatMs?: number;
}

/** One per contest with at least one viewer: a single Redis poll fanned out to every client. */
interface Room {
  contestId: string;
  clients: Set<WebSocket>;
  /** Joins still waiting for the first read; the room must not be torn down under them. */
  pending: number;
  last: Map<string, number>;
  totalVotes: number;
  ready: Promise<void>;
  timer?: NodeJS.Timeout;
  closed: boolean;
}

const ContestId = z.uuid();

export function createGateway({ redis, pollMs, log, heartbeatMs = 30_000 }: GatewayOptions) {
  const rooms = new Map<string, Room>();
  const alive = new WeakMap<WebSocket, boolean>();

  async function read(contestId: string) {
    const [totals, meta] = await Promise.all([
      redis.hgetall(redisKeys.totals(contestId)),
      redis.hget(redisKeys.meta(contestId), 'totalVotes'),
    ]);
    const map = new Map(Object.entries(totals).map(([id, v]) => [id, Number(v)]));
    const sum = [...map.values()].reduce((s, v) => s + v, 0);
    return { totals: map, totalVotes: meta === null ? sum : Number(meta) };
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
        // Assign and broadcast together, with no await in between: every client's state is
        // always "snapshot + the updates computed after it".
        room.last = next.totals;
        room.totalVotes = next.totalVotes;
        if (changed.length || totalsMoved) {
          broadcast(room, {
            type: 'update',
            contestId: room.contestId,
            changed,
            totalVotes: next.totalVotes,
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
      ready: Promise.resolve(),
      closed: false,
    };
    room.ready = read(contestId).then((first) => {
      room.last = first.totals;
      room.totalVotes = first.totalVotes;
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

  return {
    server,
    stats: () => ({
      rooms: rooms.size,
      clients: [...rooms.values()].reduce((n, r) => n + r.clients.size, 0),
    }),
    /** Close every client with 1001 so browsers reconnect elsewhere, then stop. */
    async close() {
      clearInterval(heartbeat);
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
