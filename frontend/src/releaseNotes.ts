/**
 * 版本公告随前端一起发版，没有后端和后台界面。
 * 规则见 CONTRIBUTING.md「版本公告」：
 * - 数组从新到旧，第一条是最新版本；
 * - 最新一条的 version 必须等于 frontend/package.json 的 version（vite.config.ts 会校验）。
 */

export type ReleaseCategory = 'feature' | 'improvement' | 'fix';

export interface ReleaseNoteItem {
  category: ReleaseCategory;
  title: string;
  description: string;
}

export interface ReleaseNote {
  /** 语义化版本，如 0.3.0 */
  version: string;
  /** YYYY-MM-DD */
  date: string;
  items: ReleaseNoteItem[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.3.0',
    date: '2026-11-24',
    items: [
      {
        category: 'feature',
        title: '新建测试任务时可以精确选择功能或用例',
        description:
          '任务的功能选择器现在会展开到用例：勾选功能会包含其下所有启用用例，也可以只勾单条用例；每条用例旁会显示 P0–P3 优先级。',
      },
      {
        category: 'improvement',
        title: '选择系统后自动过滤功能树',
        description:
          '在新建任务里先选系统，功能树只显示该系统；如果先选了功能再切换系统，会提示并移除其它系统的选择，避免建出范围混乱的任务。',
      },
    ],
  },
];

export const LATEST_RELEASE_VERSION: string | null = RELEASE_NOTES[0]?.version ?? null;