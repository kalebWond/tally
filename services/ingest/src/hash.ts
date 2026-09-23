import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256 of the sender, keyed by the salt. Called immediately on arrival; the raw
 * identifier goes no further than this function.
 */
export function hashSender(sender: string, salt: string): string {
  return createHmac('sha256', salt).update(sender.trim()).digest('hex');
}
