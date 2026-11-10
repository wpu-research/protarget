import tr from './tr.json';
import en from './en.json';

export type Locale = 'tr' | 'en';
export type MessageKey = keyof typeof tr;

export const DEFAULT_LOCALE: Locale = 'tr';
export const messages: Record<Locale, Record<MessageKey, string>> = { tr, en };

export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE, params: Record<string, string | number> = {}): string {
  const template = messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
