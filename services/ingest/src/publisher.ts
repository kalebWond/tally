import type { VoteEvent } from '@tally/contracts';

/** Where accepted votes go. Must throw unless the event was durably handed off. */
export interface VotePublisher {
  publish(event: VoteEvent): Promise<void>;
}
