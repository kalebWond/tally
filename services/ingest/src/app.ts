import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import {
  type ErrorResponse,
  type HealthResponse,
  IdempotencyKey,
  type VoteAccepted,
  type VoteEvent,
  VoteRequest,
} from '@tally/contracts';
import Fastify, { type FastifyError } from 'fastify';
import type { z } from 'zod';
import type { Config } from './config.js';
import { hashSender } from './hash.js';
import { logPublisher, type VotePublisher } from './publisher.js';

const BODY_LIMIT_BYTES = 4096;

interface Deps {
  config: Pick<Config, 'LOG_LEVEL' | 'VOTER_HASH_SALT'>;
  /** Defaults to the logging placeholder until F4 supplies the Redpanda producer. */
  publisher?: VotePublisher;
  /** Tests capture log output here. */
  logStream?: Writable;
}

const issuesFrom = (error: z.ZodError, prefix?: string): ErrorResponse['issues'] =>
  error.issues.map((i) => ({ path: prefix ?? i.path.join('.'), message: i.message }));

const reject = (error: string, message: string): ErrorResponse => ({
  error,
  issues: [{ path: '', message }],
});

export function buildApp({ config, publisher, logStream }: Deps) {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: {
      level: config.LOG_LEVEL,
      // Bodies aren't logged by default; this guards against anyone adding them later.
      redact: { paths: ['sender', '*.sender', 'req.body.sender'], censor: '[redacted]' },
      ...(logStream && { stream: logStream }),
    },
  });
  const votes = publisher ?? logPublisher(app.log);
  // JSON only: anything else is a clear 415 rather than a confusing schema error.
  app.removeContentTypeParser('text/plain');

  // Framework-level rejections (bad JSON, oversized body) get fixed messages, and only the error
  // code is logged. Error messages are never passed through, so no library can echo input here.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    switch (err.code) {
      case 'FST_ERR_CTP_INVALID_JSON_BODY':
      case 'FST_ERR_CTP_EMPTY_JSON_BODY':
        req.log.info({ code: err.code }, 'rejected vote');
        return reply.code(400).send(reject('invalid_request', 'body must be valid JSON'));
      case 'FST_ERR_CTP_BODY_TOO_LARGE':
        req.log.info({ code: err.code }, 'rejected vote');
        return reply
          .code(413)
          .send(reject('payload_too_large', `body must be at most ${BODY_LIMIT_BYTES} bytes`));
      case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
        req.log.info({ code: err.code }, 'rejected vote');
        return reply.code(415).send(reject('unsupported_media_type', 'send application/json'));
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      req.log.info({ code: err.code }, 'rejected request');
      return reply.code(err.statusCode).send(reject('invalid_request', 'request rejected'));
    }
    req.log.error({ code: err.code, name: err.name }, 'unhandled error');
    return reply.code(500).send(reject('internal', 'unexpected error'));
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok', service: 'ingest' }));

  app.post('/votes', async (req, reply) => {
    const body = VoteRequest.safeParse(req.body);
    const headerKey = req.headers['idempotency-key'];
    const key = headerKey === undefined ? undefined : IdempotencyKey.safeParse(headerKey);

    if (!body.success || (key && !key.success)) {
      const issues = [
        ...(body.success ? [] : issuesFrom(body.error)),
        ...(key && !key.success ? issuesFrom(key.error, 'idempotency-key') : []),
      ];
      req.log.info({ fields: issues.map((i) => i.path) }, 'rejected vote');
      return reply.code(400).send({ error: 'invalid_request', issues } satisfies ErrorResponse);
    }

    const { contestId, code, sender, source } = body.data;
    const event: VoteEvent = {
      v: 1,
      event_id: randomUUID(),
      contest_id: contestId,
      code,
      voter_hash: hashSender(sender, config.VOTER_HASH_SALT),
      source,
      sent_at: new Date().toISOString(),
      idempotency_key: key?.data ?? randomUUID(),
    };

    try {
      await votes.publish(event);
    } catch (err) {
      // Never a silent 202: the client gets a retryable failure and keeps the vote.
      req.log.error({ err, eventId: event.event_id }, 'publish failed');
      return reply.code(503).send(reject('unavailable', 'vote not accepted, retry later'));
    }

    return reply.code(202).send({
      eventId: event.event_id,
      idempotencyKey: event.idempotency_key,
    } satisfies VoteAccepted);
  });

  return app;
}
