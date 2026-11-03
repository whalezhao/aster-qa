import type { TablePaginationConfig } from 'antd';
import { getLocale, t } from '../i18n';

/**
 * 全站表格统一的分页配置：每页 20 条、可切页大小、底部显示总数。
 *
 * 每个列表都挂这一份 —— 之前各页要么 `pagination={false}`（一次全铺出来），
 * 要么各写各的页大小，看着不一致。
 */
export const PAGE: TablePaginationConfig = {
  pageSize: 20,
  showSizeChanger: true,
  pageSizeOptions: [10, 20, 50, 100],
  showTotal: (total) => t('共 {n} 条', { n: total }),
};

/** 字符串列排序：按本地规则（中文按拼音），空值排最后 */
export function byText<T>(get: (r: T) => string | null | undefined) {
  return (a: T, b: T) =>
    (get(a) ?? '').localeCompare(get(b) ?? '', getLocale() === 'en' ? 'en' : 'zh');
}

/** 数字列排序：空值当 0 */
export function byNumber<T>(get: (r: T) => number | null | undefined) {
  return (a: T, b: T) => (get(a) ?? 0) - (get(b) ?? 0);
}

/** 时间列排序：空值当最早。ISO 字符串直接比较即可（同格式同长度） */
export function byDate<T>(get: (r: T) => string | null | undefined) {
  return (a: T, b: T) => (get(a) ?? '').localeCompare(get(b) ?? '');
}

/** 枚举/状态列排序：按给定顺序，不在表里的排最后 */
export function byRank<T>(get: (r: T) => string, order: readonly string[]) {
  const rank = (v: string) => {
    const i = order.indexOf(v);
    return i === -1 ? order.length : i;
  };
  return (a: T, b: T) => rank(get(a)) - rank(get(b));
}
