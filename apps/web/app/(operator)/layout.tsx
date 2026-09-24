import type { ReactNode } from 'react';
import { AdminNav } from '@/components/admin/admin-nav';
import { OperatorTime } from '@/components/operator-time';

/**
 * Every operator page (generator and admin): times in the viewer's zone (F30), and one nav bar
 * that stays mounted from page to page (F31), so its highlight slides to the next page's link
 * instead of being drawn afresh. Signed-out requests never get here: the proxy redirects them.
 */
export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <OperatorTime>
      <AdminNav />
      {children}
    </OperatorTime>
  );
}
