// The recap video (F25), shared since F28 by `pnpm recap` (tools/recap renders an MP4) and the
// web app (/admin/recap plays it with Remotion's player). Browser-safe: no zod, no database.
// The Postgres exporter is `@tally/recap-video/export`; the props schema is `@tally/recap-video/data`.
export type { RecapData } from './data.ts';
export { Recap } from './Recap.tsx';
export * from './timing.ts';
