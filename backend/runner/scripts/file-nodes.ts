import fs from 'node:fs';
import path from 'node:path';

import { defineNode, z } from '@midscene/test';
import type { NodeExecutionContext } from '@midscene/test';
import type { PlaywrightAgent } from '@midscene/web/playwright/agent';
import type { Page } from 'playwright';

/**
 * 平台扩展节点：upload / download。
 *
 * 上传复用 midscene 的 `aiAct.fileChooserAccept`（底层是 Playwright 的
 * filechooser 事件 + setInputFiles）；下载 midscene 没有 Playwright 节点，
 * 这里直接监听 `page.waitForEvent('download')`。
 *
 * 文件路径由平台注入到 QA_FILES，YAML 只出现逻辑 key；两个节点都不走缓存。
 */

export interface FileNodeContext {
  page: Page;
  agent?: PlaywrightAgent;
}

interface UploadInput {
  prompt: string;
  file?: string;
  files?: string[];
}

interface DownloadInput {
  trigger: string;
  filename?: string;
  saveAs?: string;
  minBytes?: number;
  timeoutMs?: number;
}

const FILES = JSON.parse(process.env.QA_FILES || '{}') as Record<string, string>;
const FILES_DIR = process.env.QA_FILES_DIR || '';
const DOWNLOADS_DIR = process.env.QA_DOWNLOADS_DIR || '';
const MAX_DOWNLOAD_BYTES =
  Number(process.env.QA_MAX_DOWNLOAD_BYTES || 0) || 50 * 1024 * 1024;

function resolveFile(key: string): string {
  const value = FILES[key];
  if (!value) throw new Error(`未找到测试文件 ${key}`);
  const target = path.resolve(value);
  if (FILES_DIR) {
    const root = path.resolve(FILES_DIR);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`测试文件 ${key} 不在暂存目录内`);
    }
  }
  if (!fs.existsSync(target)) throw new Error(`测试文件 ${key} 不存在`);
  return target;
}

function safeName(name: string): string {
  const base = path.basename(name || 'download').replace(/[\\/:*?"<>|]/g, '_');
  return base.trim() || 'download';
}

export function createFileNodes<T extends FileNodeContext>(
  getAgent: (context: T) => PlaywrightAgent,
) {
  const upload = defineNode<UploadInput, unknown, T>({
    name: 'upload',
    title: 'Upload test file',
    description: 'Upload one or more project test files through a file chooser.',
    inputSchema: z.strictObject({
      prompt: z.string(),
      file: z.string().optional(),
      files: z.array(z.string()).optional(),
    }),
    async execute(ctx: NodeExecutionContext<UploadInput, T>) {
      const { input, context, signal } = ctx;
      const keys = input.files ?? (input.file ? [input.file] : []);
      if (!keys.length) throw new Error('upload 需要 file 或 files');
      if (keys.length > 10) throw new Error('单次最多上传 10 个文件');
      const paths = keys.map(resolveFile);

      // AI 可能没点上传按钮却正常返回；用 filechooser 事件确认真的打开了选择框。
      let chooserOpened = false;
      const onChooser = () => {
        chooserOpened = true;
      };
      context.page.on('filechooser', onChooser);
      try {
        await getAgent(context).aiAct(input.prompt, {
          fileChooserAccept: paths,
          cacheable: false,
          abortSignal: signal,
        });
      } finally {
        context.page.off('filechooser', onChooser);
      }
      if (!chooserOpened) throw new Error('没有出现文件选择框，上传未触发');
      return { summary: `已上传 ${keys.join('、')}` };
    },
  });

  const download = defineNode<DownloadInput, unknown, T>({
    name: 'download',
    title: 'Download file',
    description: 'Trigger a browser download, wait for it, and save it as a run artifact.',
    inputSchema: z.strictObject({
      trigger: z.string(),
      filename: z.string().optional(),
      saveAs: z.string().optional(),
      minBytes: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
    async execute(ctx: NodeExecutionContext<DownloadInput, T>) {
      const { input, context, signal } = ctx;
      if (!DOWNLOADS_DIR) throw new Error('下载目录未配置');
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

      const pending = context.page.waitForEvent('download', {
        timeout: input.timeoutMs ?? 60_000,
      });
      try {
        await getAgent(context).aiAct(input.trigger, {
          cacheable: false,
          abortSignal: signal,
        });
      } catch (error) {
        // 下载可能已经触发，只是 AI 动作在页面变化后报错。
        if (!(await pending.catch(() => undefined))) throw error;
      }

      const dl = await pending;
      const suggested = dl.suggestedFilename() || 'download';
      if (input.filename && suggested !== input.filename) {
        throw new Error(`下载文件名不符：期望 ${input.filename}，实际 ${suggested}`);
      }

      const target = path.resolve(DOWNLOADS_DIR, safeName(input.saveAs || suggested));
      const root = path.resolve(DOWNLOADS_DIR);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error('非法下载路径');
      }

      await dl.saveAs(target);
      const size = fs.statSync(target).size;
      if (size > MAX_DOWNLOAD_BYTES) {
        fs.unlinkSync(target);
        throw new Error(`下载文件超过上限：${size} bytes`);
      }
      if (input.minBytes != null && size < input.minBytes) {
        throw new Error(`下载文件过小：${size} bytes`);
      }
      return {
        summary: `已下载 ${suggested}（${size} bytes）`,
        data: { filename: suggested, size },
      };
    },
  });

  return [upload, download];
}