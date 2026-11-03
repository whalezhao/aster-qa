import { common } from './en/common';
import { pages } from './en/pages';
import { cases } from './en/cases';
import { team } from './en/team';
import { misc } from './en/misc';
import { server } from './en/server';

/**
 * 英文总表。按改造批次拆成几个文件，改动互不冲突；
 * 同名 key 以靠后的为准（后拆的批次可以覆盖前面的措辞）。
 */
export const en: Record<string, string> = {
  ...common,
  ...pages,
  ...cases,
  ...team,
  ...misc,
  ...server,
};