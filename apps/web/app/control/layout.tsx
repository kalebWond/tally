import type { ReactNode } from 'react';
import { OperatorTime } from '@/components/operator-time';

export default function Layout({ children }: { children: ReactNode }) {
  return <OperatorTime>{children}</OperatorTime>;
}
