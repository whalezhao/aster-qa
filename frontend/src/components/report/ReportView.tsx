import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Collapse,
  Empty,
  Image,
  Input,
  Modal,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  ExclamationCircleFilled,
  PlayCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import XMarkdown from '@ant-design/x-markdown';
import { apiUrl } from '../../api/client';
import { getRunReportMarkdown, getRunReportStructured } from '../../api/runs';
import type {
  ReportCase,
  ReportExecution,
  ReportKeyframe,
  ReportProject,
  ReportStep,
  ReportStructured,
  ReportTask,
} from '../../api/runs';
import { fmtDuration, fmtTokens } from '../../lib/format';
import AiFixModal from '../AiFixModal';
import KeyframePlayer from './KeyframePlayer';

const NODE_LABELS: Record<string, string> = {
  aiAct: '操作',
  aiAssert: '断言',
  aiWaitFor: '等待条件',
  aiQuery: '查询',
  aiInput: '输入',
  aiTap: '点击',
  gotoUrl: '打开页面',
  sleep: '等待',
  'runner:host-result': '执行异常',
  execution: '执行段',
};

const NODE_COLORS: Record<string, string> = {
  aiAct: 'purple',
  aiAssert: 'green',
  aiWaitFor: 'orange',
  aiQuery: 'cyan',
  gotoUrl: 'blue',
  'runner:host-result': 'red',
  execution: 'blue',
};

function StatusDot({ status }: { status: string }) {
  if (status === 'failed') return <CloseCircleFilled style={{ color: '#ff4d4f' }} />;
  if (status === 'warning') return <ExclamationCircleFilled style={{ color: '#faad14' }} />;
  if (status === 'passed' || status === 'success' || status === 'succeeded') {
    return <CheckCircleFilled style={{ color: '#52c41a' }} />;
  }
  return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />;
}

function statusText(status: string): string {
  if (status === 'passed' || status === 'success' || status === 'succeeded') return '通过';
  if (status === 'failed') return '失败';
  if (status === 'warning') return '需留意';
  if (status === 'not-run') return '未执行';
  return status;
}

function rawText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stepMatches(step: ReportStep, q: string): boolean {
  return [step.title, step.summary, step.thought, step.error, step.notRunReason]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

/** 单份执行的报告：结构化可用就用 v2，否则退回 Markdown。 */
export function RunReportView({ runId, available = true }: { runId: string; available?: boolean }) {
  const structured = useQuery({
    queryKey: ['run-report', runId],
    queryFn: () => getRunReportStructured(runId),
    enabled: available,
    retry: false,
    staleTime: 60_000,
  });

  if (!available) return <Empty description="本次执行没有可用报告" />;
  if (structured.isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }
  if (structured.isError || !structured.data) {
    return <Alert type="info" showIcon message="报告不可用（可能已被清理）" />;
  }
  if (structured.data.available && structured.data.data) {
    return (
      <ReportView
        data={structured.data.data}
        assetBase={apiUrl(`/reports/${runId}/markdown/`)}
        title="执行报告"
      />
    );
  }
  return <MarkdownReport runId={runId} />;
}

/** 任务级聚合报告：批次下所有 run 的报告合并后的视图。 */
export default function ReportView({
  data,
  assetBase,
  title,
}: {
  data: ReportStructured;
  assetBase: string;
  title: string;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'compact' | 'detailed'>('compact');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();

  const groups = data.projects
    .map((project) => {
      const projectHit = !q || project.name.toLowerCase().includes(q) || project.projectName.toLowerCase().includes(q);
      const cases = project.cases
        .map((item) => {
          const caseHit = !q || projectHit || item.name.toLowerCase().includes(q);
          const steps = q && !caseHit ? item.steps.filter((step) => stepMatches(step, q)) : item.steps;
          return { item, steps, hit: !q || caseHit || steps.length > 0 };
        })
        .filter((entry) => entry.hit);
      return { project, cases, hit: !q || projectHit || cases.length > 0 };
    })
    .filter((group) => group.hit);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const changeMode = (value: string | number) => {
    const next = value === 'compact' ? 'compact' : 'detailed';
    setMode(next);
    setCollapsed(
      next === 'compact'
        ? new Set(data.projects.flatMap((project) => project.cases.map((item) => caseKey(project, item))))
        : new Set(),
    );
  };

  const isOpen = (key: string) => (q ? true : mode === 'detailed' ? !collapsed.has(key) : collapsed.has(key));
  const showProjectHead = data.projects.length > 1 || data.kind === 'batch';

  return (
    <div className="qa-report">
      <ReportHeader data={data} title={title} />

      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索用例、步骤、断言、报错…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ width: 320 }}
        />
        <Segmented
          value={mode}
          onChange={changeMode}
          options={[
            { label: '紧凑', value: 'compact' },
            { label: '详细', value: 'detailed' },
          ]}
        />
        <Tag>{data.stats.cases} 个用例</Tag>
        <Tag>{data.stats.steps} 个步骤</Tag>
        <Tag>{data.stats.keyframes} 张关键帧</Tag>
        {data.sources.length > 1 && <Tag color="blue">已聚合 {data.sources.length} 份执行报告</Tag>}
      </Space>

      {data.legacy && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="这份报告没有用例结构，已按执行段展示"
        />
      )}

      {groups.length === 0 ? (
        <Empty description={q ? `没有匹配「${query}」的步骤` : '报告里没有用例结果'} />
      ) : (
        <div className="qa-report-projects">
          {groups.map(({ project, cases }) => (
            <section className="qa-report-project" key={project.id}>
              {showProjectHead && (
                <div className="qa-report-project-head">
                  <StatusDot status={project.status} />
                  <span className="qa-report-project-name">
                    {project.projectName || project.name}
                  </span>
                  {project.shardCount !== null && project.shardCount > 1 && (
                    <Tag>分片 {project.shardIndex}/{project.shardCount}</Tag>
                  )}
                  <span className="qa-report-project-meta">
                    <span>{project.cases.length} 个用例</span>
                    {cases.length !== project.cases.length && <span>{cases.length} 匹配</span>}
                  </span>
                </div>
              )}
              <div className="qa-report-cases">
                {cases.map(({ item, steps }) => {
                  const key = caseKey(project, item);
                  const open = isOpen(key);
                  return (
                    <CaseCard
                      key={key}
                      item={item}
                      steps={steps}
                      open={open}
                      assetBase={assetBase}
                      onToggle={() => toggle(key)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportHeader({ data, title }: { data: ReportStructured; title: string }) {
  const allPassed = data.stats.failed === 0 && data.stats.cases > 0;
  return (
    <div className="qa-report-header">
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        <Space size={8} wrap style={{ marginTop: 8 }}>
          <Tag color={allPassed ? 'success' : data.stats.failed ? 'error' : 'default'}>
            {data.stats.passed}/{data.stats.cases} 用例通过
          </Tag>
          {data.stats.failed > 0 && <Tag color="error">{data.stats.failed} 个失败</Tag>}
          <Tag>耗时 {fmtDuration(data.stats.durationMs)}</Tag>
          <Tag>{data.stats.steps} 个步骤</Tag>
          <Tag>{fmtTokens(data.stats.tokens.total)} tokens</Tag>
          {data.stats.models.length > 0 && <Tag>{data.stats.models.map((m) => m.model).join(' / ')}</Tag>}
        </Space>
      </div>
    </div>
  );
}

function caseKey(project: ReportProject, item: ReportCase): string {
  return `${project.id}:${item.id}`;
}

type CaseFrame = ReportKeyframe & { stepTitle: string };

function caseKeyframes(item: ReportCase): CaseFrame[] {
  return item.steps
    .flatMap((step) => step.keyframes.map((frame) => ({ ...frame, stepTitle: step.title })))
    .sort((left, right) => (left.time ?? 0) - (right.time ?? 0));
}

function CaseCard({
  item,
  steps,
  open,
  assetBase,
  onToggle,
}: {
  item: ReportCase;
  steps: ReportStep[];
  open: boolean;
  assetBase: string;
  onToggle: () => void;
}) {
  const [replay, setReplay] = useState<ReportKeyframe[] | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const frames = useMemo(() => caseKeyframes(item), [item]);
  return (
    <article className="qa-report-case">
      <div
        className={`qa-report-case-head${open ? ' is-open' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onToggle();
        }}
      >
        <span className="qa-report-caret">{open ? '▾' : '▸'}</span>
        <StatusDot status={item.status} />
        <span className="qa-report-case-name">{item.name}</span>
        <span className="qa-report-case-meta">
          <Tag bordered={false}>{item.steps.length} 步</Tag>
          {steps.length !== item.steps.length && <Tag color="blue">{steps.length} 匹配</Tag>}
          <Tag bordered={false} icon={<ClockCircleOutlined />}>
            {fmtDuration(item.durationMs)}
          </Tag>
          {item.attemptCount > 1 && <Tag color="warning">{item.attemptCount} 次尝试</Tag>}
          {item.status !== 'passed' && <Tag color={item.status === 'failed' ? 'error' : 'default'}>{statusText(item.status)}</Tag>}
          {item.caseUuid && (
            <Link to={`/cases/${item.caseUuid}`} onClick={(event) => event.stopPropagation()}>
              用例
            </Link>
          )}
          {item.caseUuid && item.status === 'failed' && (
            <Button
              type="text"
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                setFixOpen(true);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              AI 修复
            </Button>
          )}
          {frames.length > 1 && (
            <Button
              type="text"
              size="small"
              icon={<PlayCircleOutlined />}
              title="关键帧回放"
              onClick={(event) => {
                event.stopPropagation();
                setReplay(frames);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              关键帧
            </Button>
          )}
        </span>
      </div>
      {open && (
        <>
          <CaseTimeline frames={frames} assetBase={assetBase} onReplay={setReplay} />
          <div className="qa-report-steps">
            {steps.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的步骤" />
            ) : (
              steps.map((step) => <StepCard key={step.id} step={step} assetBase={assetBase} />)
            )}
          </div>
        </>
      )}

      <Modal
        open={replay !== null}
        onCancel={() => setReplay(null)}
        footer={null}
        width={1000}
        title={`${item.name} · 关键帧回放`}
        destroyOnHidden
      >
        {replay && <KeyframePlayer frames={replay} assetBase={assetBase} />}
      </Modal>
      <AiFixModal
        open={fixOpen}
        caseId={item.caseUuid ?? ''}
        caseName={item.name}
        onClose={() => setFixOpen(false)}
      />
    </article>
  );
}

/** 用例级关键帧时间线：把各步骤的截图按时间串起来，对应原版报告顶部的胶片条。 */
function CaseTimeline({
  frames,
  assetBase,
  onReplay,
}: {
  frames: CaseFrame[];
  assetBase: string;
  onReplay: (frames: ReportKeyframe[]) => void;
}) {
  if (frames.length === 0) return null;
  const first = frames[0]?.time ?? 0;
  return (
    <div className="qa-case-timeline">
      <div className="qa-case-timeline-head">
        <span>关键帧时间线</span>
        {frames.length > 1 && (
          <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={() => onReplay(frames)}>
            回放整个用例
          </Button>
        )}
      </div>
      <div className="qa-case-strip">
        {frames.map((frame, index) => (
          <figure className="qa-case-frame" key={`${frame.id}-${index}`} title={`${frame.stepTitle} · ${frame.label}`}>
            <Image
              src={`${assetBase}${frame.url}`}
              alt={frame.label}
              width={120}
              height={68}
              style={{ objectFit: 'cover', borderRadius: 6 }}
              preview={{ mask: '查看' }}
            />
            <figcaption>{clock((frame.time ?? first) - first)}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function StepCard({ step, assetBase }: { step: ReportStep; assetBase: string }) {
  const taskCount = step.executions.reduce((total, execution) => total + execution.tasks.length, 0);
  return (
    <section className={`qa-report-step status-${step.status}`}>
      {!step.synthetic && (
        <div className="qa-report-step-head">
          {(NODE_LABELS[step.node] ?? step.node) !== step.title && (
            <Tag color={NODE_COLORS[step.node] ?? 'default'}>{NODE_LABELS[step.node] ?? step.node}</Tag>
          )}
          <span className="qa-report-step-title">{step.title}</span>
          <span className="qa-report-step-meta">
            {step.durationMs !== null && <span>{fmtDuration(step.durationMs)}</span>}
            {step.metrics?.totalTokens ? <span>{fmtTokens(Number(step.metrics.totalTokens))} tokens</span> : null}
          </span>
        </div>
      )}

      {step.summary && <div className="qa-report-step-summary">{step.summary}</div>}
      {step.thought && <div className="qa-report-thought">{step.thought}</div>}
      {step.error && <Alert type="error" showIcon message={step.error} style={{ margin: '8px 0' }} />}
      {step.notRunReason && <Alert type="warning" showIcon message={step.notRunReason} style={{ margin: '8px 0' }} />}

      {step.keyframes.length > 0 && (
        <KeyframePlayer key={step.id} frames={step.keyframes} assetBase={assetBase} />
      )}

      {step.executions.length > 0 && (
        <Collapse
          ghost
          size="small"
          className="qa-report-exec-detail"
          items={[
            {
              key: 'detail',
              label: `执行明细（${taskCount} 个步骤事件）`,
              children: step.executions.map((execution, index) => (
                <ExecutionBlock key={`${execution.id}-${index}`} execution={execution} />
              )),
            },
          ]}
        />
      )}
    </section>
  );
}

function ExecutionBlock({ execution }: { execution: ReportExecution }) {
  return (
    <div className="qa-report-execution">
      <div className="qa-report-execution-head">
        <StatusDot status={execution.status} />
        <span className="qa-report-execution-name">{execution.name}</span>
        <span className="qa-report-execution-meta">{fmtDuration(execution.durationMs)}</span>
      </div>
      <div className="qa-report-tasks">
        {execution.tasks.map((task) => (
          <TaskRow key={task.index} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: ReportTask }) {
  const rawSections = [
    { key: 'param', label: '参数', value: task.param },
    { key: 'output', label: '输出', value: task.output },
    { key: 'log', label: '日志', value: task.log },
    { key: 'reasoning', label: '推理过程', value: task.reasoning },
    { key: 'usage', label: '模型用量', value: task.usage },
  ].filter((section) => section.value !== null && section.value !== undefined && section.value !== '');

  return (
    <div className={`qa-report-task status-${task.status}`}>
      <div className="qa-report-rail">
        <StatusDot status={task.status} />
      </div>
      <div className="qa-report-task-body">
        <div className="qa-report-task-head">
          <Tag className="qa-report-kind">{task.title}</Tag>
          <span className="qa-report-task-detail">{task.detail || '—'}</span>
          <span className="qa-report-task-meta">
            {task.durationMs !== null && <span className="qa-report-duration">{fmtDuration(task.durationMs)}</span>}
          </span>
        </div>
        {task.error && <Alert type="error" showIcon message={task.error} style={{ margin: '8px 0' }} />}
        {task.thought && <div className="qa-report-thought">{task.thought}</div>}
        {rawSections.length > 0 && (
          <Collapse
            ghost
            size="small"
            className="qa-report-raw"
            items={rawSections.map((section) => ({
              key: section.key,
              label: section.label,
              children: <pre className="qa-report-json">{rawText(section.value)}</pre>,
            }))}
          />
        )}
      </div>
    </div>
  );
}

function MarkdownReport({ runId }: { runId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['run-report-md', runId],
    queryFn: () => getRunReportMarkdown(runId),
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }
  if (isError || !data || !data.available) {
    return <Alert type="info" showIcon message="报告不可用（可能已被清理）" />;
  }
  return (
    <div className="qa-report-md">
      <XMarkdown content={data.markdown} />
    </div>
  );
}
