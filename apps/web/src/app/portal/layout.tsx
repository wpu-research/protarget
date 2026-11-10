import type { ReactNode } from 'react';
import { t } from '@protarget/i18n';
import { Shell } from '@/components/Shell';
import { PORTAL_NAV } from '@/lib/nav';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <Shell nav={PORTAL_NAV} badge={t('common.readOnly')}>{children}</Shell>;
}
