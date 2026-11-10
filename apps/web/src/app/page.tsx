import Link from 'next/link';
import { t } from '@protarget/i18n';

export default function Home() {
  return (
    <main className="home">
      <h1>{t('app.name')}</h1>
      <div className="home-links">
        <Link href="/admin">{t('home.admin')}</Link>
        <Link href="/portal">{t('home.portal')}</Link>
      </div>
    </main>
  );
}
