import { z } from 'zod';
import { GeneratorBurstRequest, GeneratorStartRequest, GeneratorStatus } from './generator.ts';
import { HealthResponse } from './health.ts';
import { ErrorResponse, VoteRequest } from './vote.ts';

/**
 * JSON Schemas for the contracts the Go generator speaks. Written to `schemas/` by
 * `pnpm --filter @tally/contracts export-schemas`; the Go contract test reads them, and
 * json-schemas.test.ts fails if the committed files drift from these Zod definitions.
 *
 * `io` picks the side of the wire: requests the generator *sends* or *receives* as input
 * (defaults optional), responses it *returns* as output (every field present).
 */
export function jsonSchemas(): Record<string, unknown> {
  return {
    'vote-request': z.toJSONSchema(VoteRequest, { io: 'input' }),
    'health-response': z.toJSONSchema(HealthResponse, { io: 'output' }),
    'error-response': z.toJSONSchema(ErrorResponse, { io: 'output' }),
    'generator-start-request': z.toJSONSchema(GeneratorStartRequest, { io: 'input' }),
    'generator-burst-request': z.toJSONSchema(GeneratorBurstRequest, { io: 'input' }),
    'generator-status': z.toJSONSchema(GeneratorStatus, { io: 'output' }),
  };
}

export const schemaFile = (name: string) => `${name}.schema.json`;
export const serialize = (schema: unknown) => `${JSON.stringify(schema, null, 2)}\n`;
