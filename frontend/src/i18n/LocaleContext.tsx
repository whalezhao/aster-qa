import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import { getLocale, setLocale, t, type Locale } from './index';

interface LocaleValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleValue | null>(null);

/** 语言切换：状态留在 context 里，真正的写入（localStorage / lang / title）在 i18n/index。 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  useEffect(() => {
    setLocale(locale);
    dayjs.locale(locale === 'en' ? 'en' : 'zh-cn');
  }, [locale]);

  const value = useMemo<LocaleValue>(
    () => ({
      locale,
      setLocale: setLocaleState,
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error(t('useLocale 必须在 LocaleProvider 内部使用'));
  return ctx;
}