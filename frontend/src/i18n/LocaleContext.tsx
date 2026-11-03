import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import { getLocale, setLocale as applyLocale, t, type Locale } from './index';

interface LocaleValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleValue | null>(null);

/** 语言切换：状态留在 context 里，真正的写入（localStorage / lang / title）在 i18n/index。 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  // 模块级 current 的初值由 i18n/index 在 import 时写入，这里只对齐 dayjs
  useEffect(() => {
    dayjs.locale(locale === 'en' ? 'en' : 'zh-cn');
  }, []);

  // t() 读的是模块级 current，必须在触发重渲染之前就位：
  // 放进 useEffect 的话这一帧子树已经按旧语言渲染完了，界面上只有按钮会变。
  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    dayjs.locale(next === 'en' ? 'en' : 'zh-cn');
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleValue>(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error(t('useLocale 必须在 LocaleProvider 内部使用'));
  return ctx;
}