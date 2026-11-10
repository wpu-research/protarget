'use client';
import { useText } from '@/components/Locale';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const text = useText();
  return <main className="error-page"><h1>{text('error.unavailable')}</h1>
    <button className="button primary" onClick={reset}>{text('common.retry')}</button></main>;
}
