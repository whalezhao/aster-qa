import type { CaseStep } from '../api/types';

export type Step = CaseStep;

/** 步骤节点名 → 中文短标签；目录和步骤卡片共用。 */
export const STEP_KIND_LABELS: Record<string, string> = {
  aiAct: '操作',
  aiTap: '点击',
  aiInput: '输入',
  aiAssert: '断言',
  aiWaitFor: '等待',
  aiQuery: '提取',
  aiLocate: '定位',
  aiScroll: '滚动',
  aiKeyboardPress: '按键',
  aiLongPress: '长按',
  aiPinch: '缩放',
  aiDragAndDrop: '拖拽',
  aiHover: '悬停',
  aiDoubleClick: '双击',
  aiRightClick: '右键',
  aiMiddleClick: '中键',
  aiClearInput: '清空输入',
  aiBoolean: '判断',
  aiNumber: '取数字',
  aiString: '取文本',
  aiAsk: '提问',
  evaluateJavaScript: '脚本',
  javascript: '脚本',
  sleep: '等待',
  wait: '等待',
  gotoUrl: '打开',
  action: '动作',
  observe: '观察',
  recordToReport: '记录报告',
  setAIContext: 'AI 上下文',
  runGherkinScenario: 'Gherkin',
  setCookies: '设置 Cookie',
  clearCookies: '清除 Cookie',
  setViewportSize: '设置视口',
  upload: '上传文件',
  download: '下载文件',
};

export function stepKindLabel(kind: string): string {
  return STEP_KIND_LABELS[kind] ?? kind;
}

export type StepOption = {
  cache?: boolean;
  deep?: boolean;
  /** aiWaitFor 的 options.timeoutMs；空 = 不写这个键 */
  timeoutMs?: number | null;
  /** aiAct 的规划力度；balance 是框架默认，不写这个键 */
  effort?: 'fast' | 'balance' | 'deepThink';
  /** 单步上下文：给这一步的额外事实/约束；空 = 删掉 */
  context?: string;
  /** aiAssert 的失败文案（步骤级键，不在 options 里） */
  message?: string;
  /** upload / download 的步骤级字段 */
  prompt?: string;
  trigger?: string;
  file?: string;
  /** 界面用逗号分隔，写 YAML 时单值写 file、多值写 files */
  files?: string;
  filename?: string;
  minBytes?: number | null;
  saveAs?: string;
};

export type YamlRow = {
  step?: Step;
  tone?: number;
  /** 这条 case 的下标：左侧用来画「一条 case 一个气泡」 */
  caseIndex?: number;
  /** 这一块里有 `- name:` 时，左侧显示同一条 case 名，左右才对得上 */
  caseName?: string;
  lines: { no: number; text: string }[];
};

/**
 * 把 YAML 按步骤切开，供左右两栏并排对照。
 * 不引 YAML 库：步骤清单已经由后端按 `- kind:` 的顺序给出，这里只按同一顺序找起始行，
 * 行数对不上（用户正在手改、格式不规范）就退回整块展示，不做猜测。
 */
export function yamlRows(yaml: string, steps: Step[]): YamlRow[] {
  const lines = yaml.replace(/\n+$/, '').split('\n');
  const caseStarts: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*-\s+name\s*:/.test(line)) caseStarts.push(i);
  });
  const starts: number[] = [];
  let cur = 0;
  for (const s of steps) {
    const re = new RegExp(`^\\s*-\\s+${s.kind}\\s*:`);
    while (cur < lines.length && !re.test(lines[cur])) cur++;
    if (cur >= lines.length) break;
    starts.push(cur);
    cur++;
  }
  const all = () => [
    { lines: lines.map((text, i) => ({ no: i + 1, text })) },
  ];
  if (starts.length !== steps.length) return all();
  const rows: YamlRow[] = [];
  const push = (from: number, to: number, step?: Step, tone?: number) => {
    if (to > from) {
      const block = lines.slice(from, to);
      const nameLine = block.find((l) => /^\s*-\s+name\s*:/.test(l));
      rows.push({
        step,
        tone,
        caseName: nameLine
          ? nameLine
              .replace(/^\s*-\s+name\s*:\s*/, '')
              .replace(/^["']|["']$/g, '')
              .trim()
          : undefined,
        lines: block.map((text, k) => ({ no: from + k + 1, text })),
      });
    }
  };
  // 行边界 = 每条 case 的 `- name:` + 每一步的起始行：左侧的 case 名才会和
  // YAML 里那一行对齐，而不是挂在整段前置内容的顶上
  const bounds = [...new Set([0, ...caseStarts, ...starts, lines.length])].sort(
    (a, b) => a - b,
  );
  const stepAt = new Map(starts.map((start, i) => [start, i]));
  for (let k = 0; k < bounds.length - 1; k++) {
    const from = bounds[k];
    const to = bounds[k + 1];
    const si = stepAt.get(from);
    push(from, to, si === undefined ? undefined : steps[si], si);
  }
  // case 名那一行也归属到它下面的 case，气泡才不会断
  let caseNo = -1;
  for (const row of rows) {
    if (row.caseName) caseNo += 1;
    row.caseIndex = row.step?.case_index ?? (caseNo >= 0 ? caseNo : undefined);
  }
  return rows;
}

const CACHE_KIND = 'aiAct';
const TIMEOUT_KIND = 'aiWaitFor';
const EFFORT_KINDS = new Set(['aiAct']);
const CONTEXT_KINDS = new Set(['aiAct', 'aiAssert', 'aiWaitFor']);
const MESSAGE_KINDS = new Set(['aiAssert']);
const UPLOAD_KIND = 'upload';
const DOWNLOAD_KIND = 'download';

/**
 * 这一步要写进 YAML 的东西：
 * - opts：options 下的键（value 为 null 表示删掉）
 * - stepKeys：与 prompt 同级的键（目前只有 aiAssert 的 message）
 */
export function optionSpec(
  kind: string,
  o: StepOption,
): { opts: Record<string, string | null>; stepKeys: Record<string, string | null> } | null {
  const opts: Record<string, string | null> = {};
  const stepKeys: Record<string, string | null> = {};
  if (kind === CACHE_KIND) {
    if (o.cache !== undefined) opts.cacheable = o.cache ? 'true' : null;
    if (o.deep !== undefined) opts.deepLocate = o.deep ? 'true' : null;
  }
  if (kind === TIMEOUT_KIND && o.timeoutMs !== undefined) {
    opts.timeoutMs = o.timeoutMs == null ? null : String(o.timeoutMs);
  }
  if (EFFORT_KINDS.has(kind) && o.effort !== undefined) {
    // balance 是默认值：选它等于不要这个键
    opts.effort = o.effort === 'balance' ? null : o.effort;
  }
  if (CONTEXT_KINDS.has(kind) && o.context !== undefined) {
    const text = o.context.trim();
    opts.context = text ? JSON.stringify(text) : null;
  }
  if (MESSAGE_KINDS.has(kind) && o.message !== undefined) {
    const text = o.message.trim();
    stepKeys.message = text ? JSON.stringify(text) : null;
  }
  if (kind === UPLOAD_KIND || kind === DOWNLOAD_KIND) {
    if (o.prompt !== undefined) {
      const text = o.prompt.trim();
      stepKeys.prompt = text ? JSON.stringify(text) : null;
    }
    if (o.trigger !== undefined) {
      const text = o.trigger.trim();
      stepKeys.trigger = text ? JSON.stringify(text) : null;
    }
    if (o.file !== undefined || o.files !== undefined) {
      const raw = (o.files ?? o.file ?? '').trim();
      const parts = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        stepKeys.files = JSON.stringify(parts);
        stepKeys.file = null;
      } else if (parts.length === 1) {
        stepKeys.file = JSON.stringify(parts[0]);
        stepKeys.files = null;
      } else {
        stepKeys.file = null;
        stepKeys.files = null;
      }
    }
    if (kind === DOWNLOAD_KIND && o.filename !== undefined) {
      const text = o.filename.trim();
      stepKeys.filename = text ? JSON.stringify(text) : null;
    }
    if (kind === DOWNLOAD_KIND && o.minBytes !== undefined) {
      stepKeys.minBytes = o.minBytes == null ? null : String(o.minBytes);
    }
    if (kind === DOWNLOAD_KIND && o.timeoutMs !== undefined) {
      stepKeys.timeoutMs = o.timeoutMs == null ? null : String(o.timeoutMs);
    }
    if (kind === DOWNLOAD_KIND && o.saveAs !== undefined) {
      const text = o.saveAs.trim();
      stepKeys.saveAs = text ? JSON.stringify(text) : null;
    }
  }
  if (!Object.keys(opts).length && !Object.keys(stepKeys).length) return null;
  return { opts, stepKeys };
}

/** 在一个步骤块里合并 options / 同级键：字符串简写会展开成块写法，空了整段删掉 */
function mergeBlockOptions(
  block: string[],
  spec: { opts: Record<string, string | null>; stepKeys: Record<string, string | null> },
) {
  const { opts, stepKeys } = spec;
  const first = block[0];
  const indent = (first.match(/^\s*/) as RegExpMatchArray)[0].length;
  const childIndent = ' '.repeat(indent + 4);
  const shorthand = /^\s*-\s*\w+\s*:\s*\S/.test(first);
  const entries = Object.entries(opts).filter(([, v]) => v !== null);
  const stepEntries = Object.entries(stepKeys).filter(([, v]) => v !== null);

  // `- upload: { prompt: ..., file: KEY }` 这类行内映射：编辑后转成块写法，
  // 否则后面的 shorthand 分支会把它误当成「- aiAct: 文本」。
  const inlineMap = first.match(/^(\s*-\s*(\w+)\s*:)\s*\{(.*)\}\s*$/);
  if (inlineMap && ['upload', 'download'].includes(inlineMap[2])) {
    const raw = inlineMap[3].trim();
    const parts =
      raw.match(/(?:[^,"']|"[^"]*"|'[^']*')+/g)?.map((item) => item.trim()) ?? [];
    const existing = new Map<string, string>();
    for (const part of parts) {
      const colon = part.indexOf(':');
      if (colon <= 0) continue;
      existing.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    for (const [key, value] of Object.entries(stepKeys)) {
      if (value === null) existing.delete(key);
      else existing.set(key, value);
    }
    block.splice(
      0,
      1,
      inlineMap[1],
      ...Array.from(existing.entries()).map(
        ([key, value]) => `${childIndent}${key}: ${value}`,
      ),
    );
    return;
  }

  if (shorthand) {
    const m = first.match(/^(\s*-\s*\w+\s*:)\s*(.*)$/);
    if (!m) return;
    if (!entries.length && !stepEntries.length) return; // 本身没有这些键，没什么可删
    const next = [`${m[1]}`, `${childIndent}prompt: ${m[2]}`];
    next.push(...stepEntries.map(([k, v]) => `${childIndent}${k}: ${v}`));
    if (entries.length) {
      next.push(
        `${childIndent}options:`,
        ...entries.map(([k, v]) => `${childIndent}  ${k}: ${v}`),
      );
    }
    block.splice(0, 1, ...next);
    return;
  }

  // 与 prompt 同级的键（aiAssert 的 message）
  for (const [key, value] of Object.entries(stepKeys)) {
    const exact = block.findIndex((l) =>
      new RegExp(`^\\s{${indent + 4}}${key}\\s*:`).test(l),
    );
    if (value === null) {
      if (exact >= 0) block.splice(exact, 1);
    } else if (exact >= 0) {
      block[exact] = `${childIndent}${key}: ${value}`;
    } else {
      const optIdx = block.findIndex((l) => /^\s+options\s*:\s*$/.test(l));
      block.splice(optIdx >= 0 ? optIdx : block.length, 0, `${childIndent}${key}: ${value}`);
    }
  }

  const oi = block.findIndex((l) => /^\s+options\s*:\s*$/.test(l));
  if (oi >= 0) {
    const oIndent = (block[oi].match(/^\s*/) as RegExpMatchArray)[0].length;
    let j = oi + 1;
    while (
      j < block.length &&
      (block[j].trim() === '' ||
        (block[j].match(/^\s*/) as RegExpMatchArray)[0].length > oIndent)
    ) {
      j++;
    }
    const children = block.slice(oi + 1, j);
    const childKeyIndent =
      (children.find((l) => l.trim())?.match(/^\s*/) as RegExpMatchArray | null)?.[0]
        .length ?? oIndent + 2;
    for (const [key, value] of Object.entries(opts)) {
      const idx = children.findIndex((l) => new RegExp(`^\\s*${key}\\s*:`).test(l));
      if (value === null) {
        if (idx >= 0) children.splice(idx, 1);
      } else if (idx >= 0) {
        children[idx] = `${' '.repeat(childKeyIndent)}${key}: ${value}`;
      } else {
        children.push(`${' '.repeat(childKeyIndent)}${key}: ${value}`);
      }
    }
    if (!children.some((l) => l.trim())) {
      block.splice(oi, j - oi); // 空了就别留一个光秃秃的 options:
    } else {
      block.splice(oi + 1, j - oi - 1, ...children);
    }
    return;
  }
  if (!entries.length) return;
  block.push(
    `${childIndent}options:`,
    ...entries.map(([k, v]) => `${childIndent}  ${k}: ${v}`),
  );
}

/**
 * 把单步选项实时画进 YAML 文本（右侧预览用）。
 * 真正执行时后端会用 YAML 解析器再写一次，这里只保证操作后立刻看得见结果。
 */
export function previewStepOptions(
  yaml: string,
  steps: Step[],
  opts: Record<string, StepOption>,
): string {
  if (!Object.keys(opts).length) return yaml;
  const lines = yaml.replace(/\n+$/, '').split('\n');
  const starts: number[] = [];
  let cur = 0;
  for (const s of steps) {
    const re = new RegExp(`^\\s*-\\s+${s.kind}\\s*:`);
    while (cur < lines.length && !re.test(lines[cur])) cur++;
    if (cur >= lines.length) break;
    starts.push(cur);
    cur++;
  }
  if (starts.length !== steps.length) return yaml;
  const caseStarts = lines.flatMap((l, i) => (/^\s*-\s+name\s*:/.test(l) ? [i] : []));
  for (let i = starts.length - 1; i >= 0; i--) {
    const step = steps[i];
    const o = opts[`${step.case_index}:${step.index}`];
    if (!o) continue;
    const spec = optionSpec(step.kind, o);
    if (!spec) continue;
    const start = starts[i];
    const nextCase = caseStarts.find((c) => c > start) ?? lines.length;
    const end = Math.min(starts[i + 1] ?? lines.length, nextCase);
    const block = lines.slice(start, end);
    while (block.length > 1 && !block[block.length - 1].trim()) block.pop();
    mergeBlockOptions(block, spec);
    lines.splice(start, end - start, ...block);
  }
  return lines.join('\n');
}