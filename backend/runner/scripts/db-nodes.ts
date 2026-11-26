import { createConnection } from 'mysql2/promise';
import { Client } from 'pg';

import { defineNode, z } from '@midscene/test';
import type { NodeExecutionContext } from '@midscene/test';
import type { PlaywrightAgent } from '@midscene/web/playwright/agent';
import type { Page } from 'playwright';

/**
 * 平台扩展节点：dbAssert。
 *
 * 执行器没有“上一步输出变成下一步变量”的机制，所以页面取值、查库、比较必须在
 * 同一个节点里完成。数据库密码只从子进程环境 QA_DATASOURCES 读取，不落盘。
 */

export interface DbNodeContext {
  page: Page;
  agent?: PlaywrightAgent;
}

interface DataSourceConfig {
  name: string;
  dialect: 'mysql' | 'oceanbase' | 'postgres';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  charset: string;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  maxRows: number;
}

interface DbAssertInput {
  datasource: string;
  sql: string;
  params?: (string | number | boolean | null)[];
  column?: string;
  row?: number;
  as?: 'number' | 'string' | 'boolean';
  tolerance?: number;
  prompt?: string;
  selector?: string;
  ignoreCase?: boolean;
  message?: string;
  timeoutMs?: number;
}

const DATA_SOURCES = JSON.parse(process.env.QA_DATASOURCES || '{}') as Record<
  string,
  DataSourceConfig
>;

const FORBIDDEN_SQL =
  /\b(insert|update|delete|replace|drop|alter|create|truncate|rename|grant|revoke|call|load_file|into\s+outfile|into\s+dumpfile|for\s+update|lock\s+in\s+share\s+mode)\b/i;

function stripSqlLiterals(sql: string): string {
  let output = '';
  let quote: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
          continue;
        }
        quote = null;
      } else if (char === '\\') {
        index += 1;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      output += ' ';
      continue;
    }
    if (sql.startsWith('--', index) || char === '#') {
      const end = sql.indexOf('\n', index);
      index = end < 0 ? sql.length : end;
      output += ' ';
      continue;
    }
    if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2);
      index = end < 0 ? sql.length : end + 1;
      output += ' ';
      continue;
    }
    output += char;
  }
  return output;
}

function validateReadonlySql(sql: string): string | null {
  if (!sql.trim()) return 'SQL 不能为空';
  if (sql.length > 10_000) return 'SQL 过长（上限 10000 字符）';
  let plain = stripSqlLiterals(sql).trim();
  if (plain.endsWith(';')) plain = plain.replace(/;\s*$/, '');
  if (plain.includes(';')) return '只允许单条 SQL，不能包含多条语句';
  const head = /^([A-Za-z]+)/.exec(plain);
  if (!head || !['select', 'with'].includes(head[1].toLowerCase())) {
    return '只允许 SELECT 或 WITH 查询';
  }
  if (FORBIDDEN_SQL.test(plain)) {
    return '只允许只读查询，禁止 INSERT/UPDATE/DELETE/DDL/OUTFILE 等写操作';
  }
  return null;
}

function parseIntValue(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('数值不是有限数字');
    return value;
  }
  const text = String(value ?? '')
    .trim()
    .replace(/[,\s￥¥$€£]/g, '')
    .replace(/元$/, '');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`无法把「${String(value)}」解析为数字`);
  return parsed;
}

function parseBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', '是', '启用', '开启'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'off', '否', '禁用', '关闭', ''].includes(text)) return false;
  throw new Error(`无法把「${String(value)}」解析为布尔值`);
}

function normalizeString(value: unknown, ignoreCase: boolean): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return ignoreCase ? text.toLowerCase() : text;
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '空';
  return String(value);
}

async function pageValue(input: DbAssertInput, context: DbNodeContext): Promise<unknown> {
  const asType = input.as ?? 'string';
  if (input.selector) {
    const text = await context.page
      .locator(input.selector)
      .first()
      .innerText({ timeout: input.timeoutMs ?? 30_000 });
    if (asType === 'number') return parseIntValue(text);
    if (asType === 'boolean') return parseBooleanValue(text);
    return text;
  }
  const agent = context.agent;
  if (!agent) throw new Error('页面取值失败：执行器没有初始化 AI agent');
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error('dbAssert 需要 prompt 或 selector');
  if (asType === 'number') return agent.aiNumber(prompt);
  if (asType === 'boolean') return agent.aiBoolean(prompt);
  return agent.aiString(prompt);
}

function compare(
  page: unknown,
  database: unknown,
  input: DbAssertInput,
): { actual: unknown; expected: unknown } {
  const asType = input.as ?? 'string';
  if (asType === 'number') {
    const actual = parseIntValue(page);
    const expected = parseIntValue(database);
    const tolerance = input.tolerance ?? 0;
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(
        input.message ||
          `数据库比对失败：页面值 ${display(actual)}，数据库值 ${display(expected)}，`
            + `容差 ${tolerance}`,
      );
    }
    return { actual, expected };
  }
  if (asType === 'boolean') {
    const actual = parseBooleanValue(page);
    const expected = parseBooleanValue(database);
    if (actual !== expected) {
      throw new Error(
        input.message ||
          `数据库比对失败：页面值 ${display(actual)}，数据库值 ${display(expected)}`,
      );
    }
    return { actual, expected };
  }
  const actual = normalizeString(page, Boolean(input.ignoreCase));
  const expected = normalizeString(database, Boolean(input.ignoreCase));
  if (actual !== expected) {
    throw new Error(
      input.message ||
        `数据库比对失败：页面值「${display(actual)}」，数据库值「${display(expected)}」`,
    );
  }
  return { actual, expected };
}

interface QueryResult {
  rows: Record<string, unknown>[];
  fieldNames: string[];
}

async function runQuery(
  source: DataSourceConfig,
  sql: string,
  params: (string | number | boolean | null)[] | undefined,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<QueryResult> {
  if (source.dialect === 'postgres') {
    const client = new Client({
      host: source.host,
      port: source.port,
      user: source.username,
      password: source.password,
      database: source.database,
      connectionTimeoutMillis: source.connectTimeoutMs,
      ssl: source.ssl ? { rejectUnauthorized: false } : false,
    });
    const onAbort = () => void client.end().catch(() => undefined);
    signal.addEventListener('abort', onAbort, { once: true });
    await client.connect();
    try {
      await client
        .query(`SET statement_timeout = ${Math.max(1, timeoutMs)}`)
        .catch(() => undefined);
      const result =
        params?.length
          ? await client.query(sql, params as unknown[])
          : await client.query(sql);
      return {
        rows: result.rows as Record<string, unknown>[],
        fieldNames: result.fields.map((field) => field.name),
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
      await client.end().catch(() => undefined);
    }
  }

  const connection = await createConnection({
    host: source.host,
    port: source.port,
    user: source.username,
    password: source.password,
    database: source.database,
    charset: source.charset || 'utf8mb4',
    connectTimeout: source.connectTimeoutMs,
    ssl: source.ssl ? {} : undefined,
    multipleStatements: false,
  });
  const onAbort = () => connection.destroy();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    // 服务端超时是 best-effort：OceanBase 和 MySQL 的会话变量不同，失败就靠
    // 只读账号 + maxRows 兜底。
    if (source.dialect === 'oceanbase') {
      await connection
        .query(`SET SESSION ob_query_timeout = ${Math.max(1, timeoutMs) * 1000}`)
        .catch(() => undefined);
    } else {
      await connection
        .query(`SET SESSION max_execution_time = ${Math.max(1, timeoutMs)}`)
        .catch(() => undefined);
    }
    const [rows, fields] = params?.length
      ? await connection.execute(sql, params)
      : await connection.query(sql);
    if (!Array.isArray(rows)) throw new Error('SQL 没有返回结果集');
    const fieldNames = (fields as { name?: string }[] | undefined)
      ?.map((field) => field.name)
      .filter((name): name is string => Boolean(name));
    return {
      rows: rows as Record<string, unknown>[],
      fieldNames: fieldNames ?? [],
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
    await connection.end().catch(() => undefined);
  }
}

export function createDbNodes() {
  return [
    defineNode<DbAssertInput, unknown, DbNodeContext>({
      name: 'dbAssert',
      title: 'Database assertion',
      description:
        'Read a value from the page, query the environment database, and compare them.',
      inputSchema: z.strictObject({
        datasource: z.string(),
        sql: z.string(),
        params: z
          .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
        column: z.string().optional(),
        row: z.number().int().nonnegative().optional(),
        as: z.enum(['number', 'string', 'boolean']).optional(),
        tolerance: z.number().nonnegative().optional(),
        prompt: z.string().optional(),
        selector: z.string().optional(),
        ignoreCase: z.boolean().optional(),
        message: z.string().optional(),
        timeoutMs: z.number().int().positive().optional(),
      }),
      async execute(ctx: NodeExecutionContext<DbAssertInput, DbNodeContext>) {
        const { input, context, signal } = ctx;
        const source = DATA_SOURCES[input.datasource];
        if (!source) {
          throw new Error(
            `当前环境没有配置数据库数据源 ${input.datasource}；请到环境 → 数据库添加`,
          );
        }
        const sqlError = validateReadonlySql(input.sql);
        if (sqlError) throw new Error(sqlError);
        if (Boolean(input.prompt) === Boolean(input.selector)) {
          throw new Error('dbAssert 必须且只能指定 prompt 或 selector 一个');
        }

        const actualPage = await pageValue(input, context);
        const sql = input.sql.trim().replace(/;\s*$/, '');
        const { rows, fieldNames } = await runQuery(
          source,
          sql,
          input.params,
          input.timeoutMs ?? source.statementTimeoutMs,
          signal,
        );
        if (rows.length > source.maxRows) {
          throw new Error(
            `SQL 返回 ${rows.length} 行，超过数据源 ${source.name} 的上限 ${source.maxRows}`,
          );
        }
        if (rows.length === 0) throw new Error('SQL 没有返回任何行');
        const rowIndex = input.row ?? 0;
        if (input.row === undefined && rows.length !== 1) {
          throw new Error(
            `SQL 返回 ${rows.length} 行；请加 LIMIT 1 或指定 row 选择其中一行`,
          );
        }
        if (rowIndex >= rows.length) {
          throw new Error(`row=${rowIndex} 超出结果行数 ${rows.length}`);
        }
        const row = rows[rowIndex];
        const column = input.column?.trim() || (fieldNames.length === 1 ? fieldNames[0] : '');
        if (!column) {
          throw new Error('SQL 返回多列；请用 column 指定要比较的列');
        }
        if (!(column in row)) {
          throw new Error(`结果里没有列 ${column}`);
        }
        const databaseValue = row[column];
        const compared = compare(actualPage, databaseValue, input);
        return {
          summary: `数据库比对通过：${column} = ${display(compared.expected)}`,
          data: {
            datasource: source.name,
            dialect: source.dialect,
            sql,
            column,
            row: rowIndex,
            pageValue: actualPage,
            dbValue: databaseValue,
            actual: compared.actual,
            expected: compared.expected,
            tolerance: input.tolerance ?? 0,
          },
        };
      },
    }),
  ];
}