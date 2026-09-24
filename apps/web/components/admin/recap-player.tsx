'use client';

import { Player } from '@remotion/player';
import { DURATION_FRAMES, FPS, HEIGHT, Recap, type RecapData, WIDTH } from '@tally/recap-video';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const n = new Intl.NumberFormat('en');
const time = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

/** Plays the recap with Remotion's player: drawn live in the browser, nothing rendered or stored. */
export function RecapPlayer({ data, loadedAt }: { data: RecapData; loadedAt: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const { contest, totalVotes, contestants } = data;
  const closed = contest.status === 'closed';

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-widest text-muted-foreground uppercase">Tally · recap</p>
          <h1 className="font-heading text-4xl font-bold tracking-wide uppercase">
            {contest.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="uppercase" data-testid="recap-status">
              {contest.status}
            </Badge>
            <span data-testid="recap-votes">
              {n.format(totalVotes)} votes · {contestants.length} contestants ·{' '}
              {closed && contest.closesAt
                ? `closed ${time(contest.closesAt)}`
                : `results as of ${time(loadedAt)}`}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/contests">
              <ArrowLeft /> Contests
            </Link>
          </Button>
          {!closed && (
            <Button
              variant="outline"
              data-testid="refresh-recap"
              disabled={refreshing}
              onClick={() => startRefresh(() => router.refresh())}
            >
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} /> Refresh
            </Button>
          )}
        </div>
      </header>

      {totalVotes === 0 ? (
        <p
          data-testid="recap-empty"
          className="rounded-xl border bg-card px-6 py-16 text-center text-muted-foreground"
        >
          {contest.name} has no votes yet, so there is nothing to recap. Run the generator on it
          from the Generator page, then come back.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-black" data-testid="recap-player">
          <Player
            // A new export is a new video: remount so it restarts from the first frame.
            key={loadedAt}
            component={Recap}
            inputProps={data}
            durationInFrames={DURATION_FRAMES}
            fps={FPS}
            compositionWidth={WIDTH}
            compositionHeight={HEIGHT}
            controls
            allowFullscreen
            clickToPlay
            style={{ width: '100%', aspectRatio: `${WIDTH} / ${HEIGHT}` }}
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {DURATION_FRAMES / FPS} s at {FPS} fps. For an MP4 file, run{' '}
        <code className="rounded bg-muted px-1.5 py-0.5">pnpm recap {contest.id}</code>.
      </p>
    </main>
  );
}
