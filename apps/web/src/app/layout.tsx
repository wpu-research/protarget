import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, t } from '@protarget/i18n';
import './globals.css';

export const metadata: Metadata = { title: t('app.name') };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body>{children}</body>
    </html>
  );
}
