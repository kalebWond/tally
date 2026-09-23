import type { VoteEvent } from '@tally/contracts';
import type { FastifyBaseLogger } from 'fastify';

/** Where accepted votes go. Must throw if the event was not durably handed off. */
export interface VotePublisher {
  publish(event: VoteEvent): Promise<void>;
}

/** Placeholder until the Redpanda producer lands in F4: logs the event and drops it. */
export function logPublisher(log: FastifyBaseLogger): VotePublisher {
  return {
    async publish(event) {
      log.debug({ event }, 'vote accepted (no broker yet)');
    },
  };
}
