import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { t } from '@protarget/i18n';
import { locale } from '@/lib/server';
import { LocaleProvider } from '@/components/Locale';
import './globals.css';

export const metadata: Metadata = { title: t('app.name') };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = await locale();
  return (
    <html lang={language}>
      <body><LocaleProvider locale={language}>{children}</LocaleProvider></body>
    </html>
  );
}
