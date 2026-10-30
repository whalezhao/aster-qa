import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import QaTable from '../components/QaTable';
import { PageContainer } from '@ant-design/pro-components';
import { PlusOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  createTask,
  deleteTask,
  deleteTasks,
  getTasks,
  runTask,
  updateTask,
  type TaskListParams,
} from '../api/tasks';
import { getProjects } from '../api/projects';
import { getIterationsByTeam } from '../api/iterations';
import { apiError } from '../api/client';
import { useActiveTeam } from '../team/TeamContext';
import { useAuth } from '../auth/AuthContext';
import { getSettings, updateSettings } from '../api/settings';
import FeatureTreeSelect from '../components/FeatureTreeSelect';
import PreflightModal from '../components/PreflightModal';
import { getTeamEnvironments } from '../api/environments';
import {
  BATCH_STATUS_COLORS,
  BATCH_STATUS_LABELS,
  fmtDateTime,
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from '../lib/format';
import { PAGE, byDate, byNumber, byRank, byText } from '../lib/table';
import type { FeatureStage, Task, TaskStatus, TaskType } from '../api/types';

const typeOptions = (Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => ({
  value: t,
  label: TASK_TYPE_LABELS[t],
}));

const statusOptions = (Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => ({
  value: s,
  label: TASK_STATUS_LABELS[s],
}));

interface TaskFormValues {
  name: string;
  type: TaskType;
  description?: string;
  project_id?: string | null;
  iteration_id?: string | null;
  retry_count?: number;
  environment_name?: string | null;
  gate_enabled?: boolean;
  gate_min_pass_rate?: number | null;
  gate_fail_on_p0?: boolean;
  feature_ids?: string[];
  run_now?: boolean;
}

export default function Tasks() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // 团队只从上下文取，页面不再自带一个选择器
  const { teamId } = useActiveTeam();
  const { user: me } = useAuth();

  // 全局执行并发（保存在服务端，所有 worker 共享）
  const { data: appSettings } = useQuery({ queryKey: ['app-settings'], queryFn: getSettings });
  const concurrencyMutation = useMutation({
    mutationFn: (value: number) => updateSettings({ max_concurrent_runs: value }),
    onSuccess: (saved) => {
      message.success(
        `全局执行并发已调整为 ${saved.max_concurrent_runs}，worker 会在 10 秒内跟上`,
      );
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    },
    onError: (e) => message.error(apiError(e)),
  });
  const shardMutation = useMutation({
    mutationFn: (value: number) => updateSettings({ run_shard_size: value }),
    onSuccess: (saved) => {
      message.success(
        saved.run_shard_size
          ? `单 run 用例数已设为 ${saved.run_shard_size}，新执行会按此分片`
          : '已关闭分片：一个项目一个 run',
      );
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    },
    onError: (e) => message.error(apiError(e)),
  });
  const assessMutation = useMutation({
    mutationFn: (value: boolean) => updateSettings({ ai_assess_failures_only: value }),
    onSuccess: (saved) => {
      message.success(
        saved.ai_assess_failures_only
          ? '已开启：只有出现失败的批次才会调用 AI 评估'
          : '已关闭：每个批次都会调用 AI 评估',
      );
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    },
    onError: (e) => message.error(apiError(e)),
  });
  const canTuneConcurrency = Boolean(me?.teams.some((t) => t.role !== 'member'));

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [preflightTaskId, setPreflightTaskId] = useState<string | null>(null);
  const [form] = Form.useForm<TaskFormValues>();
  // 勾选的任务 —— 「快速多任务执行」就是一次跑掉这几条
  const [selected, setSelected] = useState<string[]>([]);

  // 筛选条件进 URL：刷新、分享、浏览器前进后退都能还原
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project_id') ?? undefined;
  const stage = (searchParams.get('stage') as FeatureStage | null) ?? 'all';
  const status = searchParams.get('status') ?? undefined;
  const name = searchParams.get('name') ?? '';
  const [nameInput, setNameInput] = useState(name);
  useEffect(() => setNameInput(name), [name]);

  const updateParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const params: TaskListParams = {
    project_id: projectId,
    stage: stage === 'all' ? undefined : stage,
    status,
    name: name.trim() || undefined,
  };

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => getProjects(teamId as string),
    enabled: Boolean(teamId),
  });
  const { data: iterations = [] } = useQuery({
    queryKey: ['iterations', teamId],
    queryFn: () => getIterationsByTeam(teamId as string),
    enabled: Boolean(teamId),
  });
  const { data: teamEnvironments = [] } = useQuery({
    queryKey: ['team-environments', teamId],
    queryFn: () => getTeamEnvironments(teamId as string),
    enabled: Boolean(teamId),
  });
  const environmentNames = Array.from(new Set(teamEnvironments.map((env) => env.name)));
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', teamId, params],
    queryFn: () => getTasks(teamId as string, params),
    enabled: Boolean(teamId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['batches'] });
  };

  const saveMutation = useMutation({
    mutationFn: (v: TaskFormValues) => {
      const payload: TaskFormValues = { ...v };
      if (editing) delete payload.run_now;
      if (payload.gate_min_pass_rate != null) {
        // 表单里填百分数，接口收 0..1
        payload.gate_min_pass_rate = payload.gate_min_pass_rate / 100;
      }
      if (editing) {
        // 类型/功能/项目在创建时就固化了（用例是快照），PATCH 不接受这些字段
        return updateTask(editing.id, {
          name: payload.name,
          description: payload.description,
          iteration_id: payload.iteration_id ?? null,
          retry_count: payload.retry_count,
          environment_name: payload.environment_name ?? null,
          gate_enabled: payload.gate_enabled,
          gate_min_pass_rate: payload.gate_min_pass_rate,
          gate_fail_on_p0: payload.gate_fail_on_p0,
        });
      }
      return createTask(teamId as string, { ...payload, name: payload.name });
    },
    onSuccess: (res) => {
      setOpen(false);
      invalidate();
      // 建完就直接跑：带 run_now 时后端已经建好批次，直接跳到执行详情看进度
      if (!editing && 'batch_id' in res && res.batch_id) {
        message.success(`任务已创建，已触发执行（快照 ${res.case_count} 个用例）`);
        navigate(`/executions/${res.batch_id}`);
        return;
      }
      if (!editing && 'case_count' in res) {
        message.success(`任务已创建（快照 ${res.case_count} 个用例 / ${res.feature_count} 个功能）`);
        return;
      }
      message.success('任务已更新');
    },
    onError: (e) => message.error(apiError(e)),
  });

  const runMutation = useMutation({
    mutationFn: ({ id, environmentNames }: { id: string; environmentNames: string[] }) =>
      runTask(id, environmentNames),
    onSuccess: (res) => {
      message.success(
        res.batches.length > 1
          ? `已触发执行：${res.batches.length} 个环境各一条执行记录`
          : '已触发执行',
      );
      invalidate();
      if (res.batches.length > 1) {
        navigate(`/executions?task_id=${res.task_id}`);
        return;
      }
      navigate(`/executions/${res.batch_id}`);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      message.success('任务已删除（执行记录一并清理）');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => deleteTasks(ids),
    onSuccess: (res) => {
      setSelected([]);
      invalidate();
      if (res.skipped.length === 0) {
        message.success(`已删除 ${res.deleted} 个任务及其执行记录`);
      } else {
        message.warning(
          `已删除 ${res.deleted} 个；${res.skipped.length} 个没删（${res.skipped
            .map((s) => `${s.name}：${s.reason}`)
            .join('；')}）`,
        );
      }
    },
    onError: (e) => message.error(apiError(e)),
  });

  // 勾了几个任务就依次各触发一次执行。串行是刻意的：单个 worker 本来就排队跑，
  // 并发发请求只会让错误信息拧在一起，哪个任务没跑起来反而看不清。
  const bulkRun = useMutation({
    mutationFn: async (ids: string[]) => {
      const failed: { name: string; msg: string }[] = [];
      for (const id of ids) {
        try {
          await runTask(id);
        } catch (e) {
          failed.push({ name: tasks.find((t) => t.id === id)?.name ?? id, msg: apiError(e) });
        }
      }
      return failed;
    },
    onSuccess: (failed, ids) => {
      setSelected([]);
      invalidate();
      if (failed.length === 0) {
        message.success(`已触发 ${ids.length} 个任务的执行`);
      } else {
        // 部分成功要说清楚是哪几个没起来，否则用户以为都跑了
        message.warning(
          `${ids.length - failed.length} 个已触发，${failed.length} 个没起来：` +
            failed.map((f) => `${f.name}（${f.msg}）`).join('；'),
        );
      }
      navigate('/executions');
    },
  });

  function confirmBulkRun() {
    const picked = tasks.filter((t) => selected.includes(t.id));
    modal.confirm({
      title: `执行选中的 ${picked.length} 个任务？`,
      width: 520,
      content: (
        <div>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            {picked.slice(0, 10).map((t) => (
              <li key={t.id}>
                {t.name}（{t.case_count} 个用例）
              </li>
            ))}
          </ul>
          {picked.length > 10 ? <div>…还有 {picked.length - 10} 个</div> : null}
          <Typography.Text type="secondary">
            每个任务各建一次执行，排队串行跑（执行器一次只跑一个）。
          </Typography.Text>
        </div>
      ),
      okText: '执行',
      cancelText: '取消',
      onOk: () => bulkRun.mutateAsync(selected),
    });
  }

  function confirmBulkDelete() {
    const picked = tasks.filter((t) => selected.includes(t.id));
    modal.confirm({
      title: `删除选中的 ${picked.length} 个任务？`,
      width: 520,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            {picked.slice(0, 10).map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
          {picked.length > 10 ? <div>…还有 {picked.length - 10} 个</div> : null}
          <Typography.Text type="danger">
            它们的执行记录、报告和 AI 结论会一并删除，不可恢复。正在执行的任务会被跳过。
          </Typography.Text>
        </div>
      ),
      onOk: () => bulkDelete.mutateAsync(selected),
    });
  }

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name;
  const iterationName = (id: string | null) => iterations.find((i) => i.id === id)?.name;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'feature_regression',
      retry_count: 0,
      run_now: false,
      gate_enabled: false,
      gate_fail_on_p0: false,
    });
    setOpen(true);
  };

  return (
    <PageContainer
      ghost
      header={{
        title: '测试任务',
        subTitle: '一个任务 = 一组功能的组合；勾选多个任务可以一次触发',
        extra: [
          <Tooltip
            key="assess"
            title={
              canTuneConcurrency
                ? '开启后，全部通过的批次不再调用模型做评估 —— 每批评估都是一次真实成本'
                : '只有团队管理员能调整'
            }
          >
            <Space size={6}>
              <Typography.Text type="secondary">AI 评估</Typography.Text>
              <Switch
                size="small"
                checked={appSettings?.ai_assess_failures_only}
                disabled={!canTuneConcurrency || assessMutation.isPending}
                loading={assessMutation.isPending}
                onChange={(value) => assessMutation.mutate(value)}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {appSettings?.ai_assess_failures_only ? '仅有失败时' : '每批都评'}
              </Typography.Text>
            </Space>
          </Tooltip>,
          <Tooltip
            key="concurrency"
            title={
              canTuneConcurrency
                ? '全局并发上限：所有 worker 加起来最多同时跑多少个 run（每个 run 一个浏览器）。改完 10 秒内生效。'
                : '只有团队管理员能调整并发数'
            }
          >
            <Space size={6}>
              <Typography.Text type="secondary">全局执行并发</Typography.Text>
              <Select
                size="small"
                style={{ width: 74 }}
                value={appSettings?.max_concurrent_runs}
                disabled={!canTuneConcurrency || concurrencyMutation.isPending}
                loading={concurrencyMutation.isPending}
                onChange={(value) => concurrencyMutation.mutate(value)}
                options={[1, 2, 3, 4, 6, 8, 12, 16].map((n) => ({ value: n, label: String(n) }))}
              />
            </Space>
          </Tooltip>,
          <Tooltip
            key="shard"
            title={
              canTuneConcurrency
                ? '一个项目里的用例按这个数量拆成多个 run 并行跑；0 表示不分片。只影响之后新建的执行。'
                : '只有团队管理员能调整分片'
            }
          >
            <Space size={6}>
              <Typography.Text type="secondary">单 run 用例数</Typography.Text>
              <Select
                size="small"
                style={{ width: 74 }}
                value={appSettings?.run_shard_size}
                disabled={!canTuneConcurrency || shardMutation.isPending}
                loading={shardMutation.isPending}
                onChange={(value) => shardMutation.mutate(value)}
                options={[
                  { value: 0, label: '不分片' },
                  ...[1, 2, 3, 4, 5, 8, 10, 20].map((n) => ({ value: n, label: String(n) })),
                ]}
              />
            </Space>
          </Tooltip>,
          // 这里原来是「快速回归」，点开那页和「新建任务」弹窗是同一件事 —— 换成
          // 勾选多个任务一次触发
          <Button
            key="bulk"
            icon={<ThunderboltOutlined />}
            disabled={selected.length === 0}
            loading={bulkRun.isPending}
            onClick={confirmBulkRun}
          >
            快速多任务执行{selected.length > 0 ? `（${selected.length}）` : ''}
          </Button>,
          <Button
            key="bulk-delete"
            danger
            disabled={selected.length === 0}
            loading={bulkDelete.isPending}
            onClick={confirmBulkDelete}
          >
            批量删除{selected.length > 0 ? `（${selected.length}）` : ''}
          </Button>,
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建任务
          </Button>,
        ],
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
        <Select
          allowClear
          placeholder="全部状态"
          style={{ minWidth: 140 }}
          value={status}
          onChange={(value) => updateParams({ status: value })}
          options={statusOptions}
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

      <QaTable<Task>
        rowKey="id"
        loading={isLoading}
        dataSource={tasks}
        pagination={PAGE}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as string[]),
          // 正在跑的任务既不能重复执行、也不能删（后端会 409），直接不给勾；
          // 没有用例的任务照样能勾 —— 它跑不了，但可以删
          getCheckboxProps: (r) => ({
            disabled: r.status === 'queued' || r.status === 'running',
            title:
              r.status === 'queued' || r.status === 'running'
                ? '这个任务已有执行在进行中'
                : undefined,
          }),
        }}
        columns={[
          {
            title: '任务',
            dataIndex: 'name',
            sorter: byText<Task>((r) => r.name),
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <Space size={4}>
                  <Link to={`/tasks/${r.id}`}>{r.name}</Link>
                  {/* 人审签名：列表上要一眼看出这个任务有没有人签过 */}
                  {r.signed && (
                    <Tooltip title={`已签名 · ${fmtDateTime(r.signed_at)}`}>
                      <Tag color="success" icon={<SafetyCertificateOutlined />}>
                        已签名
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {TASK_TYPE_LABELS[r.type] ?? r.type}
                  {r.project_id ? ` · ${projectName(r.project_id) ?? ''}` : ' · 跨项目'}
                  {r.iteration_id ? ` · ${iterationName(r.iteration_id) ?? ''}` : ''}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '组合',
            width: 150,
            sorter: byNumber<Task>((r) => r.feature_count),
            render: (_, r) => (
              <Space size={4}>
                <Tooltip title="任务里包含的功能数">
                  <Tag>{r.feature_count} 个功能</Tag>
                </Tooltip>
                <Tooltip title="快照下来的用例数">
                  <Tag>{r.case_count} 个用例</Tag>
                </Tooltip>
              </Space>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            sorter: byRank<Task>((r) => r.status, [
              'draft',
              'queued',
              'running',
              'completed',
              'failed',
              'cancelled',
            ]),
            render: (_, r) => (
              <Tag color={TASK_STATUS_COLORS[r.status]}>{TASK_STATUS_LABELS[r.status] ?? r.status}</Tag>
            ),
          },
          {
            title: '定时',
            width: 120,
            sorter: byDate<Task>((r) => r.schedule_next_run_at),
            render: (_, r) =>
              r.schedule_enabled ? (
                <Tooltip title={`下次 ${fmtDateTime(r.schedule_next_run_at)}`}>
                  <Tag color="green">定时</Tag>
                </Tooltip>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              ),
          },
          {
            title: '最近执行',
            width: 210,
            sorter: byDate<Task>((r) => r.last_run_at),
            render: (_, r) =>
              r.last_batch_id ? (
                <Space direction="vertical" size={0}>
                  <Link to={`/executions/${r.last_batch_id}`}>
                    <Tag color={BATCH_STATUS_COLORS[r.last_batch_status ?? ''] ?? 'default'}>
                      {BATCH_STATUS_LABELS[r.last_batch_status ?? ''] ?? r.last_batch_status}
                    </Tag>
                  </Link>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtDateTime(r.last_run_at)}
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Text type="secondary">还没跑过</Typography.Text>
              ),
          },
          {
            title: '操作',
            width: 210,
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<ThunderboltOutlined />}
                  loading={runMutation.isPending && runMutation.variables?.id === r.id}
                  disabled={r.status === 'queued' || r.status === 'running'}
                  onClick={() => setPreflightTaskId(r.id)}
                >
                  执行
                </Button>
                <Button size="small" onClick={() => navigate(`/executions?task_id=${r.id}`)}>
                  执行记录
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue({
                      name: r.name,
                      type: r.type,
                      description: r.description ?? undefined,
                      project_id: r.project_id,
                      iteration_id: r.iteration_id,
                      retry_count: r.retry_count,
                      environment_name: r.environment_name,
                      gate_enabled: r.gate_enabled,
                      gate_min_pass_rate:
                        r.gate_min_pass_rate == null
                          ? undefined
                          : Math.round(r.gate_min_pass_rate * 100),
                      gate_fail_on_p0: r.gate_fail_on_p0,
                    });
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="删除该任务及其执行记录？"
                  description="执行记录、报告和 AI 结论会一并删除，不可恢复。"
                  onConfirm={() => deleteMutation.mutate(r.id)}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑任务' : '新建任务'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        forceRender
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} preserve={false}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input placeholder="如：v2.6 上线前回归" />
          </Form.Item>

          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={typeOptions} disabled={Boolean(editing)} />
          </Form.Item>

          <Form.Item
            name="feature_ids"
            label="包含的功能"
            tooltip={
              editing
                ? '功能与用例在创建任务时就已快照固定，不能再改；需要新组合请新建任务。'
                : '任务就是一堆功能的组合。选中后会把功能下启用中的用例快照进任务 —— 之后再给功能加用例，不会影响这个已定稿的任务。'
            }
          >
            <FeatureTreeSelect teamId={teamId} disabled={Boolean(editing)} />
          </Form.Item>

          {!editing && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="保存后可以立即执行"
              description="打开下面的开关，保存的同时就会按项目拆分成多次执行并开始跑。"
            />
          )}

          <Space style={{ display: 'flex' }} align="start" wrap>
            <Form.Item name="project_id" label="项目" style={{ width: 220 }}>
              <Select
                allowClear
                placeholder="跨项目可留空"
                disabled={Boolean(editing)}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
            <Form.Item name="iteration_id" label="迭代" style={{ width: 200 }}>
              <Select
                allowClear
                placeholder="可不选"
                options={iterations.map((i) => ({ value: i.id, label: i.name }))}
              />
            </Form.Item>
            <Form.Item name="retry_count" label="重试次数" style={{ width: 120 }}>
              <InputNumber min={0} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="environment_name"
              label="环境"
              style={{ width: 180 }}
              tooltip="跨项目任务要求每个项目都有同名环境；留空使用「默认」"
            >
              <Select
                allowClear
                placeholder="默认"
                options={environmentNames.map((name) => ({ value: name, label: name }))}
              />
            </Form.Item>
            <Form.Item name="gate_enabled" label="质量门禁" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="gate_min_pass_rate"
              label="最低通过率 (%)"
              style={{ width: 140 }}
            >
              <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
            <Form.Item name="gate_fail_on_p0" label="P0 失败即拒绝" valuePropName="checked">
              <Switch />
            </Form.Item>
            {!editing && (
              <Form.Item name="run_now" label="保存后立即执行" valuePropName="checked">
                <Switch />
              </Form.Item>
            )}
          </Space>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
      <PreflightModal
        open={Boolean(preflightTaskId)}
        taskId={preflightTaskId ?? ''}
        taskName={tasks.find((task) => task.id === preflightTaskId)?.name}
        defaultEnvironmentName={
          tasks.find((task) => task.id === preflightTaskId)?.environment_name ?? undefined
        }
        onCancel={() => setPreflightTaskId(null)}
        onRun={(environmentNames) => {
          const id = preflightTaskId;
          setPreflightTaskId(null);
          if (id) runMutation.mutate({ id, environmentNames });
        }}
      />
    </PageContainer>
  );
}
