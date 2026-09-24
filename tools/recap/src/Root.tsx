import { DURATION_FRAMES, FPS, HEIGHT, Recap, WIDTH } from '@tally/recap-video';
import { RecapData } from '@tally/recap-video/data';
import { Composition } from 'remotion';

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
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={DURATION_FRAMES}
      defaultProps={EMPTY}
      schema={RecapData}
    />
  );
}
