import { t } from '@protarget/i18n';
import { Placeholder } from '@/components/Shell';
import { ADMIN_NAV, findNavLabel } from '@/lib/nav';

// Tüm admin rotaları şimdilik tek yer tutucu sayfaya düşer; her ekran kendi fazında gerçek sayfayla değişecek.
export default async function AdminPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const path = ['/admin', ...slug].join('/');
  const label = findNavLabel(ADMIN_NAV, path);
  return <Placeholder title={label ? t(label) : path} />;
}
