import { en } from './en';

export type Locale = 'zh' | 'en';

const STORAGE_KEY = 'qa_locale';

/**
 * 中文原文即 key。默认中文，不跟随浏览器语言 —— 团队内部默认中文，
 * 英文是主动切换出来的。
 */
let current: Locale = readStored();

function readStored(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    /* 隐私模式下 localStorage 可能抛错，按中文走 */
    return 'zh';
  }
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* 存不了就算了，不影响使用 */
  }
  applyDocument();
}

function applyDocument(): void {
  document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN';
  document.title = t('Aster QA · AI 测试管理平台');
}

/**
 * 后端返回的文案里带变量的那几条，没法逐字查表，用正则替换。
 * 只收真正会出现在界面上的，别把 AI/报告里的文字往里塞。
 */
const PATTERNS: { re: RegExp; en: string }[] = [
  { re: /^共 (\d+) 个项目有待执行用例$/, en: '$1 project(s) with pending cases' },
  { re: /^(\d+) 个 run 执行失败$/, en: '$1 run(s) failed' },
  { re: /^通过率 ([\d.]+%) 低于要求 ([\d.]+%)$/, en: 'Pass rate $1 is below the required $2' },
  { re: /^(\d+) 个 P0 用例失败$/, en: '$1 P0 case(s) failed' },
  { re: /^需要 (.+) 及以上权限$/, en: 'Requires $1 or higher' },
  { re: /^(\d+) 个功能不存在$/, en: '$1 feature(s) not found' },
  { re: /^(\d+) 个用例不存在$/, en: '$1 case(s) not found' },
  { re: /^(\d+) 个功能不存在或不属于该团队$/, en: '$1 feature(s) not found in this team' },
  { re: /^(\d+) 个用例不存在或不属于该团队$/, en: '$1 case(s) not found in this team' },
  { re: /^未知事件：(.+)$/, en: 'Unknown event: $1' },
];

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** 中文模式下原样返回（只回填变量），英文模式查表，查不到回退中文。 */
export function t(zh: string, vars?: Record<string, string | number>): string {
  if (current === 'zh') return fill(zh, vars);
  const hit = en[zh];
  if (hit !== undefined) return fill(hit, vars);
  for (const { re, en: replacement } of PATTERNS) {
    if (re.test(zh)) return fill(zh.replace(re, replacement), vars);
  }
  return fill(zh, vars);
}

// 首屏就把 lang / title 落到已保存的语言上，避免英文用户看到中文标题
applyDocument();