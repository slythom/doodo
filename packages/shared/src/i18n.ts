import fr from './fr.json';

export type Locale = 'fr';
export type TranslationKey = keyof typeof fr;

const dictionaries: Record<Locale, typeof fr> = { fr };

export function t(key: TranslationKey, locale: Locale = 'fr'): string {
  return dictionaries[locale][key] ?? key;
}
