import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { ADMIN_NAV } from '@/lib/nav';
import { requireUser } from '@/lib/server';
export default async function AdminLayout({ children }: { children: ReactNode }) {
  return <Shell nav={ADMIN_NAV} user={await requireUser(['ADMIN'])}>{children}</Shell>;
}
