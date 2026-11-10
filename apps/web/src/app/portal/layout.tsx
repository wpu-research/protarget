import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { PORTAL_NAV } from '@/lib/nav';
import { requireUser } from '@/lib/server';
export default async function PortalLayout({ children }: { children: ReactNode }) {
  return <Shell nav={PORTAL_NAV} user={await requireUser(['AGENCY', 'ADVERTISER'])}>{children}</Shell>;
}
