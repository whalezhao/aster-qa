import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Empty, Input, Segmented, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { TrophyOutlined } from '@ant-design/icons';
import QaTable from '../components/QaTable';
import { PageContainer } from '@ant-design/pro-components';
import { getBatches, type Batch, type BatchFeature } from '../api/batches';
import { getProjects } from '../api/projects';
import { getTasks } from '../api/tasks';
import { useActiveTeam } from '../team/TeamContext';
import {
  BATCH_STATUS_COLORS,
  BATCH_STATUS_LABELS,
  fmtDateTime,
  fmtDuration,
  TASK_TYPE_LABELS,
} from '../lib/format';
import { PAGE, byDate, byNumber, byRank, byText } from '../lib/table';
import type { FeatureStage } from '../api/types';

const ACTIVE = ['running'];

/** AI 对一次执行的结论。列表上直接可见 —— 不用点进去才知道 AI 怎么看。 */
const AI_VERDICT: Record<string, { color: string; label: string }> = {
  healthy: { color: 'success', label: '健康' },
  risky: { color: 'warning', label: '有风险' },
  needs_attention: { color: 'error', label: '需关注' },
  unknown: { color: 'default', label: '未判定' },
};

/** 一个功能的通过情况。颜色直接表达「这个功能过没过」。 */
function FeatureChip({ feature }: { feature: BatchFeature }) {
  const ok = feature.failed === 0;
  const pending = feature.passed + feature.failed < feature.total;
  return (
    <Tooltip
      title={`${feature.name}（${feature.stage === 'released' ? '正式' : '迭代中'}）通过 ${feature.passed}/${feature.total}`}
    >
      <Tag color={pending ? 'processing' : ok ? 'success' : 'error'}>
        {feature.name} {feature.passed}/{feature.total}
      </Tag>
    </Tooltip>
  );
}

export default function Executions() {
  const navigate = useNavigate();
  const { teamId } = useActiveTeam();
  const [searchParams, setSearchParams] = useSearchParams();

  // 筛选与分页都进 URL：刷新/分享/前进后退都能还原，服务端分页也能直接重放
  const projectId = searchParams.get('project_id') ?? undefined;
  const stage = (searchParams.get('stage') as FeatureStage | null) ?? 'all';
  const name = searchParams.get('name') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSize = Number(searchParams.get('page_size') ?? 20) || 20;
  // 支持从任务详情跳过来只看某个任务的执行
  const taskId = searchParams.get('task_id') ?? undefined;

  const [nameInput, setNameInput] = useState(name);
  useEffect(() => setNameInput(name), [name]);

  const updateParams = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => getProjects(teamId as string),
    enabled: Boolean(teamId),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', teamId, {}],
    queryFn: () => getTasks(teamId as string),
    enabled: Boolean(teamId),
  });

  const params = useMemo(
    () => ({
      team_id: teamId ?? undefined,
      project_id: projectId,
      stage: stage === 'all' ? undefined : stage,
      name: name.trim() || undefined,
      task_id: taskId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [teamId, projectId, stage, name, taskId, page, pageSize],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['batches', params],
    queryFn: () => getBatches(params),
    enabled: Boolean(teamId),
    // 有执行在跑时自动刷新，不用手点
    refetchInterval: (q) =>
      q.state.data?.items.some((b) => ACTIVE.includes(b.status)) ? 3000 : false,
  });

  const batches = data?.items ?? [];
  const taskName = (id: string | null) => tasks.find((t) => t.id === id)?.name;

  return (
    <PageContainer
      ghost
      header={{
        title: '执行记录',
        subTitle: '每行是一次执行（一个任务点一次「执行」）；跨项目的任务会拆成多次运行，但在这里算一件事',
        extra: taskId
          ? [
              <Typography.Text key="hint" type="secondary">
                只看任务「{taskName(taskId) ?? taskId.slice(0, 8)}」
              </Typography.Text>,
              <Link key="clear" to="/executions">
                清除筛选
              </Link>,
            ]
          : undefined,
      }}
    >

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="全部项目"
          style={{ minWidth: 180 }}
          value={projectId}
          onChange={(value) => updateParams({ project_id: value })}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Segmented
          value={stage}
          onChange={(value) =>
            updateParams({ stage: value === 'all' ? undefined : (value as string) })
          }
          options={[
            { value: 'all', label: '全部分期' },
            { value: 'in_iteration', label: '当前迭代' },
            { value: 'released', label: '正式' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="按任务名搜索"
          style={{ width: 220 }}
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
          onSearch={(value) => updateParams({ name: value.trim() || undefined })}
        />
      </Space>

      <QaTable<Batch>
        rowKey="id"
        loading={isLoading}
        dataSource={batches}
        pagination={{
          ...PAGE,
          current: page,
          pageSize,
          total: data?.total ?? 0,
          onChange: (nextPage, nextSize) =>
            updateParams(
              {
                page: String(nextSize !== pageSize ? 1 : nextPage),
                page_size: String(nextSize),
              },
              false,
            ),
        }}
        onRow={(r) => ({
          style: { cursor: 'pointer' },
          onClick: () => navigate(`/executions/${r.id}`),
        })}
        columns={[
          {
            title: '执行',
            sorter: byDate<Batch>((r) => r.created_at),
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <Link to={`/executions/${r.id}`}>{r.name}</Link>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtDateTime(r.created_at)}
                  {r.trigger !== 'manual'
                    ? ` · ${
                        {
                          regression: '回归',
                          rerun: '重跑失败',
                          schedule: '定时',
                          ci: 'CI',
                        }[r.trigger] ?? r.trigger
                      }`
                    : ''}
                  {r.environment_name ? ` · 环境 ${r.environment_name}` : ''}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '测试任务',
            width: 200,
            sorter: byText<Batch>((r) => r.task_name),
            render: (_, r) =>
              r.task_id && r.task_name ? (
                <Space direction="vertical" size={0}>
                  <Link to={`/tasks/${r.task_id}`}>{r.task_name}</Link>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {(TASK_TYPE_LABELS as Record<string, string>)[r.task_type ?? ''] ?? r.task_type}
                    {r.task_case_count ? ` · ${r.task_case_count} 个用例` : ''}
                    {r.task_feature_count ? ` · ${r.task_feature_count} 个功能` : ''}
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              ),
          },
          {
            title: '状态',
            width: 130,
            sorter: byRank<Batch>((r) => r.status, [
              'running',
              'empty',
              'completed',
              'completed_with_failures',
              'partial',
              'excluded',
              'failed',
              'cancelled',
            ]),
            render: (_, r) => (
              <Tag color={BATCH_STATUS_COLORS[r.status] ?? 'default'}>
                {BATCH_STATUS_LABELS[r.status] ?? r.status}
              </Tag>
            ),
          },
          {
            title: '结果',
            width: 120,
            sorter: byNumber<Batch>((r) => (r.total ? r.passed / r.total : -1)),
            render: (_, r) =>
              r.total === 0 ? (
                <Typography.Text type="secondary">-</Typography.Text>
              ) : (
                <Space size={4}>
                  <Typography.Text strong={r.failed > 0} type={r.failed > 0 ? 'warning' : undefined}>
                    {r.passed}/{r.total}
                  </Typography.Text>
                  {r.excluded_runs > 0 && (
                    <Tooltip title={`${r.excluded_runs} 次执行因模型额度/配置/网络问题未计入统计`}>
                      <Tag>未计入 {r.excluded_runs}</Tag>
                    </Tooltip>
                  )}
                </Space>
              ),
          },
          {
            title: 'AI 判断',
            width: 100,
            sorter: byRank<Batch>((r) => r.ai_verdict ?? '', [
              'healthy',
              'risky',
              'needs_attention',
              'unknown',
            ]),
            render: (_, r) => {
              // 全绿批次不调 AI：用奖杯代替「未评估」，和详情页的卡片一致
              if (r.total > 0 && r.passed === r.total) {
                return (
                  <Tooltip title="全部通过：不需要 AI 分析">
                    <Tag color="success" icon={<TrophyOutlined />}>
                      全部通过
                    </Tag>
                  </Tooltip>
                );
              }
              if (r.ai_status === 'pending') return <Tag color="processing">分析中</Tag>;
              if (r.ai_status === 'failed') {
                return (
                  <Tooltip title="这次执行没有拿到 AI 结论（可能是项目没配模型）">
                    <Tag>未评估</Tag>
                  </Tooltip>
                );
              }
              const view = AI_VERDICT[r.ai_verdict ?? 'unknown'];
              if (!view) return <Typography.Text type="secondary">-</Typography.Text>;
              return <Tag color={view.color}>{view.label}</Tag>;
            },
          },
          {
            title: '功能（各功能通过情况）',
            // 这是这一页的核心：一行里看到这次执行里每个功能过没过
            sorter: byNumber<Batch>((r) => r.features.length),
            render: (_, r) =>
              r.features.length === 0 ? (
                <Typography.Text type="secondary">-</Typography.Text>
              ) : (
                <Space size={4} wrap>
                  {r.features.map((f) => (
                    <FeatureChip key={f.feature_id} feature={f} />
                  ))}
                </Space>
              ),
          },
          {
            title: '项目',
            width: 90,
            sorter: byNumber<Batch>((r) => r.project_count),
            render: (_, r) => (r.project_count > 1 ? `${r.project_count} 个` : '1 个'),
          },
          {
            title: '耗时',
            width: 90,
            sorter: byNumber<Batch>((r) => r.duration_ms),
            render: (_, r) => fmtDuration(r.duration_ms),
          },
        ]}
        locale={{
          emptyText: (
            <Empty description="还没有执行记录。到「测试任务」里点一次执行就有了。" />
          ),
        }}
      />
      {/* 这一页是服务端取「最近 100 条」，分页和排序都只在这 100 条里做 —— 说清楚，
          免得有人以为按通过率排出来的第一名是全部历史里的第一名 */}
      {data && data.total > batches.length ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          共 {data.total} 次执行，本页只加载了最近 {batches.length} 条：分页与排序都在这
          {batches.length} 条之内。
        </Typography.Paragraph>
      ) : null}
    </PageContainer>
  );
}
