import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Empty,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { Column, Line, Pie } from '@ant-design/plots';
import XMarkdown from '@ant-design/x-markdown';
import dayjs, { type Dayjs } from 'dayjs';
import {
  getStatsBreakdown,
  getStatsFailures,
  getStatsFlaky,
  getStatsOverview,
  getStatsRegression,
  getStatsTrend,
  type StatsScopeParams,
} from '../api/stats';
import { getLatestTeamReview, runTeamReview } from '../api/ai';
import { apiError } from '../api/client';
import { getProjects } from '../api/projects';
import { getIterationsByTeam } from '../api/iterations';
import AiMascot from '../components/AiMascot';
import SpeakButton from '../components/SpeakButton';
import QaTable from '../components/QaTable';
import RequirementCoverageTab from './stats/RequirementCoverageTab';
import { useActiveTeam } from '../team/TeamContext';
import {
  fmtDateTime,
  fmtDuration,
  fmtPercent,
  fmtTokens,
  TASK_STATUS_COLORS,
  taskStatusLabel,
} from '../lib/format';
import { t } from '../i18n';
import { PAGE, byDate, byNumber, byRank, byText } from '../lib/table';
import { useTheme } from '../theme/ThemeContext';
import type { StatsFlaky, StatsRegressionRow } from '../api/types';

const { RangePicker } = DatePicker;

type Dimension = 'team' | 'project';
type Preset = '7' | '30' | '90' | 'custom';

const PRESET_OPTIONS = [
  { label: '近 7 天', value: '7' },
  { label: '近 30 天', value: '30' },
  { label: '近 90 天', value: '90' },
  { label: '自定义', value: 'custom' },
];

export default function Stats() {
  const { teamId } = useActiveTeam();
  const [searchParams, setSearchParams] = useSearchParams();

  // 所有筛选都进 URL：刷新、分享、从图表点回列表都能还原
  const dimension = (searchParams.get('dimension') as Dimension) ?? 'team';
  const projectId = searchParams.get('project_id') ?? undefined;
  const iterationId = searchParams.get('iteration_id') ?? undefined;
  const preset = (searchParams.get('preset') as Preset) ?? '30';
  const customFrom = searchParams.get('from');
  const customTo = searchParams.get('to');

  const range = useMemo<[Dayjs, Dayjs]>(() => {
    if (preset === 'custom' && customFrom && customTo) {
      return [dayjs(customFrom), dayjs(customTo)];
    }
    const days = preset === 'custom' ? 30 : Number(preset);
    return [dayjs().subtract(days - 1, 'day'), dayjs()];
  }, [preset, customFrom, customTo]);

  const dateFrom = range[0].format('YYYY-MM-DD');
  const dateTo = range[1].format('YYYY-MM-DD');
  const days = range[1].diff(range[0], 'day') + 1;

  const patch = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => getProjects(teamId!),
    enabled: !!teamId,
  });
  const { data: iterations = [] } = useQuery({
    queryKey: ['iterations', teamId],
    queryFn: () => getIterationsByTeam(teamId as string),
    enabled: !!teamId,
  });

  const scope: StatsScopeParams = {
    team_id: teamId ?? undefined,
    project_id: dimension === 'project' ? projectId : undefined,
    iteration_id: iterationId,
    date_from: dateFrom,
    date_to: dateTo,
  };

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith('stats'),
      });
      await queryClient.invalidateQueries({ queryKey: ['team-ai-review', teamId] });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ProCard title={t('统计')}>
      <Space wrap style={{ marginBottom: 16 }} size={12}>
        <Segmented
          value={dimension}
          onChange={(value) =>
            patch({ dimension: value as string, project_id: undefined })
          }
          options={[
            { label: t('团队维度'), value: 'team' },
            { label: t('项目维度'), value: 'project' },
          ]}
        />
        {dimension === 'project' && (
          <Select
            style={{ minWidth: 220 }}
            placeholder={t('选择项目')}
            value={projectId}
            onChange={(value) => patch({ project_id: value })}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
        <Select
          allowClear
          style={{ minWidth: 180 }}
          placeholder={t('全部迭代')}
          value={iterationId}
          onChange={(value) => patch({ iteration_id: value })}
          options={iterations.map((i) => ({ value: i.id, label: i.name }))}
        />
        <Segmented
          value={preset}
          onChange={(value) => {
            if (value === 'custom') {
              patch({
                preset: 'custom',
                from: dateFrom,
                to: dateTo,
              });
            } else {
              patch({ preset: value as string, from: undefined, to: undefined });
            }
          }}
          options={PRESET_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
        />
        {preset === 'custom' && (
          <RangePicker
            value={range}
            allowClear={false}
            onChange={(value) => {
              if (!value?.[0] || !value?.[1]) return;
              patch({
                preset: 'custom',
                from: value[0].format('YYYY-MM-DD'),
                to: value[1].format('YYYY-MM-DD'),
              });
            }}
          />
        )}
        <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refresh}>
          {t('刷新')}
        </Button>
      </Space>

      <TabsBlock scope={scope} days={days} dimension={dimension} teamId={teamId} iterationId={iterationId} />
    </ProCard>
  );
}

function TabsBlock({
  scope,
  days,
  dimension,
  teamId,
  iterationId,
}: {
  scope: StatsScopeParams;
  days: number;
  dimension: Dimension;
  teamId: string | null;
  iterationId?: string;
}) {
  const [tab, setTab] = useState('overview');

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Segmented
          value={tab}
          onChange={(value) => setTab(value as string)}
          options={[
            { label: t('总览'), value: 'overview' },
            { label: t('回归进度'), value: 'regression' },
            { label: t('需求覆盖'), value: 'coverage' },
          ]}
        />
      </Space>
      {tab === 'overview' ? (
        <OverviewTab scope={scope} days={days} dimension={dimension} teamId={teamId} />
      ) : tab === 'regression' ? (
        <RegressionTab teamId={teamId} iterationId={iterationId} />
      ) : (
        <RequirementCoverageTab
          params={{
            team_id: scope.team_id,
            project_id: scope.project_id,
            iteration_id: scope.iteration_id,
          }}
        />
      )}
    </div>
  );
}

function OverviewTab({
  scope,
  days,
  dimension,
  teamId,
}: {
  scope: StatsScopeParams;
  days: number;
  dimension: Dimension;
  teamId: string | null;
}) {
  const { isDark } = useTheme();
  const chartTheme = { type: isDark ? 'classicDark' : 'classic' };

  const { data: overview, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['stats-overview', dimension, scope],
    queryFn: () => getStatsOverview(scope),
    enabled: !!teamId,
  });
  const { data: breakdown } = useQuery({
    queryKey: ['stats-breakdown', dimension, scope],
    queryFn: () => getStatsBreakdown(scope),
    enabled: !!teamId,
  });
  const { data: trend = [] } = useQuery({
    queryKey: ['stats-trend', dimension, scope],
    queryFn: () => getStatsTrend({ ...scope, bucket: 'day', days }),
    enabled: !!teamId,
  });
  const { data: failures = [] } = useQuery({
    queryKey: ['stats-failures', dimension, scope, days],
    queryFn: () => getStatsFailures({ ...scope, days, limit: 20 }),
    enabled: !!teamId,
  });
  const { data: flaky = [] } = useQuery({
    queryKey: ['stats-flaky', dimension, scope.team_id, scope.project_id],
    queryFn: () => getStatsFlaky({ team_id: scope.team_id, project_id: scope.project_id, limit: 50 }),
    enabled: !!teamId,
  });

  const insufficient = overview ? !overview.sample_sufficient : false;
  const compare = overview?.compare ?? null;

  const trendData = trend.flatMap((point) => {
    const label = point.bucket ? point.bucket.slice(5, 10) : t('未关联');
    const rows = [];
    if (point.pass_rate != null) {
      rows.push({ bucket: label, type: t('最终通过率'), value: +(point.pass_rate * 100).toFixed(1) });
    }
    if (point.pass_rate_lower_bound != null) {
      rows.push({
        bucket: label,
        type: t('置信下界'),
        value: +(point.pass_rate_lower_bound * 100).toFixed(1),
      });
    }
    return rows;
  });

  const statusData = (breakdown?.status_breakdown ?? [])
    .filter((item) => item.runs > 0)
    .map((item) => ({ ...item, label: t(item.label) }));
  const failureKindData = (breakdown?.failure_kinds ?? []).map((item) => ({
    ...item,
    label: t(item.label),
  }));
  const durationData = (breakdown?.duration_buckets ?? []).map((item) => ({
    ...item,
    label: t(item.label),
  }));

  return (
    <div>
      {/* AI 复盘是这一页的重点，放最上面：先看结论，再看明细 */}
      <div style={{ marginBottom: 16 }}>
        <AiReviewSection teamId={teamId} />
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={8}>
          <ProCard loading={isLoading}>
            <Statistic
              title={
                <Tooltip title={t('通过率 = 通过用例数 / 执行用例数（先求和再相除）。置信下界用 Wilson 计算，n 越小声誉越低。')}>
                  <span>{t('最终通过率')}</span>
                </Tooltip>
              }
              value={fmtPercent(overview?.final_pass_rate ?? null)}
              valueStyle={insufficient ? { color: 'rgba(128,128,128,0.65)' } : undefined}
            />
            <Space direction="vertical" size={2} style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('置信下界 {lower} · 样本 {n} 个用例', {
                  lower: fmtPercent(overview?.pass_rate_lower_bound ?? null),
                  n: overview?.sample_size ?? 0,
                })}
                {insufficient ? t('（n<3，先别下结论）') : ''}
              </Typography.Text>
              <RateDelta current={overview?.final_pass_rate} previous={compare?.final_pass_rate} />
            </Space>
          </ProCard>
        </Col>

        <Col xs={24} sm={12} xl={8}>
          <ProCard loading={isLoading}>
            <Statistic title={t('首次通过率')} value={fmtPercent(overview?.first_pass_rate ?? null)} />
            <Space direction="vertical" size={2} style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('靠重试救回 {rate} 的用例', { rate: fmtPercent(overview?.retry_recovery_rate ?? null) })}
              </Typography.Text>
              <RateDelta current={overview?.first_pass_rate} previous={compare?.first_pass_rate} />
            </Space>
          </ProCard>
        </Col>

        <Col xs={24} sm={12} xl={8}>
          <ProCard loading={isLoading}>
            <Statistic title={t('执行次数')} value={overview?.runs ?? 0} suffix={t('次')} />
            <Space direction="vertical" size={2} style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('覆盖 {n} 个用例', { n: overview?.sample_size ?? 0 })}
                {(overview?.excluded_infra_runs ?? 0) > 0
                  ? t(' · {n} 次非用例原因未计入', { n: overview?.excluded_infra_runs ?? 0 })
                  : ''}
              </Typography.Text>
              <CountDelta current={overview?.runs} previous={compare?.runs} suffix={t('次')} />
            </Space>
          </ProCard>
        </Col>

        <Col xs={24} sm={12} xl={8}>
          <ProCard loading={isLoading}>
            <Statistic
              title={t('失败用例')}
              value={overview?.failed ?? 0}
              valueStyle={{ color: (overview?.failed ?? 0) > 0 ? '#E8A23B' : undefined }}
            />
            <Space direction="vertical" size={2} style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('{passed}/{total} 通过', { passed: overview?.passed ?? 0, total: overview?.sample_size ?? 0 })}
              </Typography.Text>
              <CountDelta
                current={overview?.failed}
                previous={compare?.failed}
                suffix={t('个')}
                invert
              />
            </Space>
          </ProCard>
        </Col>

        <Col xs={24} sm={12} xl={8}>
          <ProCard loading={isLoading}>
            <Statistic title={t('平均耗时')} value={fmtDuration(overview?.avg_duration_ms ?? null)} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('中位耗时 {duration}', { duration: fmtDuration(overview?.median_duration_ms ?? null) })}
            </Typography.Text>
          </ProCard>
        </Col>

        <Col xs={24} sm={12} xl={8}>
          <ProCard loading={isLoading}>
            <Statistic title={t('Token 用量')} value={fmtTokens(overview?.ai_total_tokens ?? null)} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('AI 调用 {calls} 次 · 模型耗时 {duration}', {
                calls: overview?.ai_calls ?? 0,
                duration: fmtDuration(overview?.ai_cost_ms ?? null),
              })}
            </Typography.Text>
          </ProCard>
        </Col>
      </Row>

      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        {t('首次通过率与最终通过率之差，就是「靠重试蒙过去」的部分。置信下界（Wilson）才是诚实的读数。')}
        {(overview?.excluded_infra_runs ?? 0) > 0 &&
          t(' 另有 {n} 次执行因模型额度/服务/网络问题未计入通过率。', { n: overview?.excluded_infra_runs ?? 0 })}
        {dataUpdatedAt > 0 &&
          t('（数据更新于 {time}）', { time: fmtDateTime(new Date(dataUpdatedAt).toISOString()) })}
      </Typography.Paragraph>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={16}>
          <ProCard size="small" title={t('通过率趋势')}>
            {trendData.length === 0 ? (
              <Empty description={t('暂无数据')} />
            ) : (
              <Line
                data={trendData}
                xField="bucket"
                yField="value"
                seriesField="type"
                smooth
                height={280}
                theme={chartTheme}
                yAxis={{ max: 100, min: 0 }}
                tooltip={{ items: [{ channel: 'y', valueFormatter: (v: number) => `${v}%` }] }}
              />
            )}
          </ProCard>
        </Col>
        <Col xs={24} xl={8}>
          <ProCard size="small" title={t('执行结果分布')}>
            {statusData.length === 0 ? (
              <Empty description={t('暂无数据')} />
            ) : (
              <Pie
                data={statusData}
                angleField="runs"
                colorField="label"
                innerRadius={0.62}
                height={280}
                theme={chartTheme}
                legend={{ color: { position: 'bottom' } }}
                scale={{
                  color: {
                    range: ['#22B07D', '#F5A33C', '#E85C5C', '#8C8C8C', '#4F8CFF'],
                  },
                }}
                tooltip={{ items: [{ channel: 'y', valueFormatter: (v: number) => t('{n} 次', { n: v }) }] }}
              />
            )}
          </ProCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <ProCard size="small" title={t('非用例原因的失败')}>
            {failureKindData.length === 0 ? (
              <Empty description={t('没有因模型额度 / 服务 / 网络被排除的执行')} />
            ) : (
              <Column
                data={failureKindData}
                xField="label"
                yField="runs"
                height={240}
                theme={chartTheme}
                scale={{ x: { padding: 0.5 } }}
                tooltip={{ items: [{ channel: 'y', valueFormatter: (v: number) => t('{n} 次', { n: v }) }] }}
              />
            )}
          </ProCard>
        </Col>
        <Col xs={24} xl={12}>
          <ProCard size="small" title={t('耗时分布（每次执行）')}>
            {durationData.length === 0 ? (
              <Empty description={t('暂无数据')} />
            ) : (
              <Column
                data={durationData}
                xField="label"
                yField="runs"
                height={240}
                theme={chartTheme}
                scale={{ x: { padding: 0.35 } }}
                tooltip={{ items: [{ channel: 'y', valueFormatter: (v: number) => t('{n} 次', { n: v }) }] }}
              />
            )}
          </ProCard>
        </Col>
      </Row>

      <ProCard size="small" title={t('失败最集中的功能')} style={{ marginTop: 16 }}>
        <QaTable
          rowKey="feature_id"
          dataSource={breakdown?.top_failing_features ?? []}
          pagination={false}
          locale={{ emptyText: t('这段时间没有失败用例') }}
          columns={[
            {
              title: t('功能'),
              dataIndex: 'feature_name',
              sorter: byText((r: { feature_name: string }) => r.feature_name),
              render: (_, r) => <Link to={`/features/${r.feature_id}`}>{r.feature_name}</Link>,
            },
            { title: t('项目'), dataIndex: 'project_name', width: 220 },
            {
              title: t('失败次数'),
              dataIndex: 'failures',
              width: 120,
              sorter: byNumber((r: { failures: number }) => r.failures),
              render: (v: number) => <Typography.Text type="danger">{v}</Typography.Text>,
            },
          ]}
        />
      </ProCard>

      <ProCard size="small" title={t('失败用例排行')} style={{ marginTop: 16 }}>
        {failures.length === 0 ? (
          <Empty description={t('暂无失败用例，保持住')} />
        ) : (
          <Column
            data={failures}
            xField="case_name"
            yField="failures"
            height={260}
            theme={chartTheme}
            // 只有一两个用例时，默认的柱宽会糊满整张图 —— 按条数给 band padding
            scale={{ x: { padding: failures.length <= 3 ? 0.7 : 0.2 } }}
            xAxis={{ label: { autoRotate: true, autoHide: true } }}
            tooltip={{ items: [{ channel: 'y', valueFormatter: (v: number) => t('{n} 次', { n: v }) }] }}
          />
        )}
      </ProCard>

      <ProCard size="small" title={t('Flaky 用例榜单')} style={{ marginTop: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('AI 执行器对同一用例时过时不过属常态，单次失败不等价于缺陷。flakiness 越高越值得人工复核。')}
        />
        <QaTable<StatsFlaky>
          rowKey="test_case_id"
          dataSource={flaky}
          pagination={PAGE}
          locale={{ emptyText: t('暂无数据') }}
          columns={[
            {
              title: t('用例'),
              dataIndex: 'case_name',
              sorter: byText<StatsFlaky>((r) => r.case_name),
              render: (_, r) => <Link to={`/cases/${r.test_case_id}`}>{r.case_name}</Link>,
            },
            {
              title: t('功能'),
              dataIndex: 'feature_name',
              sorter: byText<StatsFlaky>((r) => r.feature_name),
              render: (v: string | null) => v || '-',
            },
            {
              title: t('执行次数'),
              dataIndex: 'runs',
              width: 100,
              sorter: byNumber<StatsFlaky>((r) => r.runs),
            },
            {
              title: t('通过'),
              dataIndex: 'passed',
              width: 80,
              sorter: byNumber<StatsFlaky>((r) => r.passed),
            },
            {
              title: t('失败'),
              dataIndex: 'failed',
              width: 80,
              sorter: byNumber<StatsFlaky>((r) => r.failed),
            },
            {
              title: 'Flakiness',
              dataIndex: 'flakiness',
              width: 160,
              sorter: byNumber<StatsFlaky>((r) => r.flakiness),
              render: (v: number) => (
                <Progress
                  percent={Math.round(v * 100)}
                  size="small"
                  status={v > 0.3 ? 'exception' : 'normal'}
                />
              ),
            },
            {
              title: t('最近状态'),
              dataIndex: 'last_status',
              width: 110,
              sorter: byRank<StatsFlaky>((r) => r.last_status ?? '', ['success', 'failed']),
              render: (v: string | null) => v || '-',
            },
            {
              title: t('最近执行'),
              dataIndex: 'last_run_at',
              sorter: byDate<StatsFlaky>((r) => r.last_run_at),
              render: (v: string | null) => fmtDateTime(v),
            },
          ]}
        />
      </ProCard>
    </div>
  );
}

/** 通过率环比：±x.x 个百分点，涨绿跌红。 */
function RateDelta({
  current,
  previous,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
}) {
  if (current == null || previous == null) return null;
  const diff = (current - previous) * 100;
  if (Math.abs(diff) < 0.05) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('与上期持平')}
      </Typography.Text>
    );
  }
  const good = diff > 0;
  return (
    <Typography.Text style={{ fontSize: 12, color: good ? '#22B07D' : '#E85C5C' }}>
      {t('{arrow} {diff} 个百分点 vs 上期', {
        arrow: diff > 0 ? '↑' : '↓',
        diff: Math.abs(diff).toFixed(1),
      })}
    </Typography.Text>
  );
}

/** 次数环比：失败次数是越少越好（invert）。 */
function CountDelta({
  current,
  previous,
  suffix,
  invert = false,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  suffix: string;
  invert?: boolean;
}) {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  if (diff === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('与上期持平')}
      </Typography.Text>
    );
  }
  const good = invert ? diff < 0 : diff > 0;
  return (
    <Typography.Text style={{ fontSize: 12, color: good ? '#22B07D' : '#E85C5C' }}>
      {t('{arrow} {diff} {suffix} vs 上期', {
        arrow: diff > 0 ? '↑' : '↓',
        diff: Math.abs(diff),
        suffix,
      })}
    </Typography.Text>
  );
}

function RegressionTab({
  teamId,
  iterationId,
}: {
  teamId: string | null;
  iterationId?: string;
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['stats-regression', teamId, iterationId],
    queryFn: () => getStatsRegression({ team_id: teamId ?? undefined, iteration_id: iterationId }),
    enabled: !!teamId,
  });

  return (
    <QaTable<StatsRegressionRow>
      rowKey="task_id"
      loading={isLoading}
      dataSource={rows}
      pagination={PAGE}
      locale={{ emptyText: t('暂无回归任务') }}
      columns={[
        {
          title: t('回归任务'),
          dataIndex: 'name',
          sorter: byText<StatsRegressionRow>((r) => r.name),
          render: (_, r) => <Link to={`/tasks/${r.task_id}`}>{r.name}</Link>,
        },
        {
          title: t('状态'),
          dataIndex: 'status',
          width: 110,
          sorter: byRank<StatsRegressionRow>((r) => r.status, [
            'draft',
            'queued',
            'running',
            'completed',
            'failed',
            'cancelled',
          ]),
          render: (s: string) => <Tag color={TASK_STATUS_COLORS[s]}>{taskStatusLabel(s)}</Tag>,
        },
        {
          title: t('覆盖功能'),
          dataIndex: 'features',
          width: 100,
          sorter: byNumber<StatsRegressionRow>((r) => r.features),
        },
        {
          title: t('run 数'),
          dataIndex: 'runs',
          width: 90,
          sorter: byNumber<StatsRegressionRow>((r) => r.runs),
        },
        {
          title: t('通过 / 总数'),
          width: 120,
          sorter: byNumber<StatsRegressionRow>((r) => (r.total ? r.passed / r.total : -1)),
          render: (_, r) => `${r.passed}/${r.total}`,
        },
        {
          title: t('失败'),
          dataIndex: 'failed',
          width: 80,
          sorter: byNumber<StatsRegressionRow>((r) => r.failed),
        },
        {
          title: t('通过率'),
          width: 100,
          sorter: byNumber<StatsRegressionRow>((r) => r.pass_rate),
          render: (_, r) => fmtPercent(r.pass_rate),
        },
        {
          title: t('置信下界'),
          width: 100,
          sorter: byNumber<StatsRegressionRow>((r) => r.pass_rate_lower_bound),
          render: (_, r) => fmtPercent(r.pass_rate_lower_bound),
        },
        {
          title: t('进度'),
          width: 180,
          sorter: byNumber<StatsRegressionRow>((r) => (r.total ? r.passed / r.total : -1)),
          render: (_, r) => (
            <Progress
              percent={r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0}
              size="small"
              status={r.failed > 0 ? 'exception' : 'success'}
            />
          ),
        },
      ]}
    />
  );
}

/** 团队近况的 AI 复盘：按需生成，结果落库，再打开时先展示上一次。 */
function AiReviewSection({ teamId }: { teamId: string | null }) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);

  const { data: latest } = useQuery({
    queryKey: ['team-ai-review', teamId],
    queryFn: () => getLatestTeamReview(teamId as string),
    enabled: Boolean(teamId),
  });

  const generate = useMutation({
    mutationFn: () => runTeamReview(teamId as string, days),
    onSuccess: (result) => {
      queryClient.setQueryData(['team-ai-review', teamId], result);
      message.success(t('复盘已生成'));
    },
    onError: (e) => message.error(apiError(e)),
  });

  const check = generate.data ?? latest;
  const markdown = check?.markdown;

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <span>{t('时间范围')}</span>
        <Segmented
          value={days}
          onChange={(value) => setDays(value as number)}
          options={[
            { label: t('近 7 天'), value: 7 },
            { label: t('近 14 天'), value: 14 },
            { label: t('近 30 天'), value: 30 },
          ]}
        />
        <Button type="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
          {markdown ? t('重新生成') : t('生成复盘')}
        </Button>
        {markdown && <SpeakButton text={markdown} />}
      </Space>

      {markdown ? (
        <div
          className="qa-ai-card"
          style={{ padding: 20, borderRadius: 14, background: token.colorFillQuaternary }}
        >
          <XMarkdown content={markdown} />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            {check?.model_name ? t('由 {model} 生成 · ', { model: check.model_name }) : ''}
            {check?.created_at ? fmtDateTime(check.created_at) : ''}{t(' · 仅供参考')}
          </Typography.Paragraph>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '40px 0' }}>
          <AiMascot size={96} state={generate.isPending ? 'thinking' : 'idle'} />
          <Typography.Text strong>
            {generate.isPending ? t('正在读最近的执行记录…') : t('让 AI 汇总最近的测试情况，给一份优化建议')}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('会综合通过率、失败集中度、Flaky 用例和执行频次；生成一次要几十秒')}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
