import { Composition } from 'remotion';
import { DURATION_FRAMES, FPS, RecapData } from './data.ts';
import { Recap } from './Recap.tsx';

const EMPTY: RecapData = {
  contest: { id: '', name: 'Tally', status: 'closed', closesAt: null },
  totalVotes: 0,
  contestants: [],
  steps: [],
};

/** One composition, 1080p30, fed by the props `pnpm recap` exports from Postgres. */
export function Root() {
  return (
    <Composition
      id="Recap"
      component={Recap}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={DURATION_FRAMES}
      defaultProps={EMPTY}
      schema={RecapData}
    />
  );
}
