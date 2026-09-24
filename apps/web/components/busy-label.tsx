import { LoaderCircle } from 'lucide-react';

/**
 * A button's label while its request runs (F31): the words say what's happening and the
 * spinner shows it hasn't stalled. Spins only while something real is in flight.
 */
export function BusyLabel({ children }: { children: string }) {
  return (
    <>
      <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
      {children}
    </>
  );
}
