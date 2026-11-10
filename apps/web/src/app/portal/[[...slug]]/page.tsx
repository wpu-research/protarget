import { t } from '@protarget/i18n';
import { Placeholder } from '@/components/Shell';
import { PORTAL_NAV, findNavLabel } from '@/lib/nav';

export default async function PortalPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const path = ['/portal', ...slug].join('/');
  const label = findNavLabel(PORTAL_NAV, path);
  return <Placeholder title={label ? t(label) : path} />;
}
