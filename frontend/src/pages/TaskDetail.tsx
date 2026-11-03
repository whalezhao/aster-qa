import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Tabs, Tag, Tooltip } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { AuditOutlined, PlayCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import {
  getTask,
  getTaskCases,
  getTaskFeatures,
  getTaskSignoff,
  getTaskTags,
  revokeTaskSignoff,
  runTask,
  setTaskTags,
  signTask,
  type TaskFeature,
} from '../api/tasks';
import { getBatches, signBatchReport, type Batch } from '../api/batches';
import { getTagsByTeam } from '../api/tags';
import { runTaskPrecheck } from '../api/ai';
import { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import AiInsightCard from '../components/AiInsightCard';
import PreflightModal from '../components/PreflightModal';
import TaskScheduleTab from '../components/TaskScheduleTab';
import { t } from '../i18n';
import {
  BATCH_STATUS_COLORS,
  batchStatusLabel,
  fmtDateTime,
  fmtDuration,
  TASK_STATUS_COLORS,
  taskStatusLabel,
  taskTypeLabel,
} from '../lib/format';
import { PAGE, byDate, byNumber, byRank, byText } from '../lib/table';
import type { AiCheckResult, TaskCase, TaskSignoff, TaskTag } from '../api/types';
import QaTable from '../components/QaTable';

export default function TaskDetail() {
  const { tid = '' } = useParams();
  const { message } = App.useApp();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signOpen, setSignOpen] = useState(false);
  const [signForm] = Form.useForm<{ note?: string }>();
  // 报告签章是执行记录粒度的：先选要签哪一条执行记录，再签它的报告
  const [reportSignOpen, setReportSignOpen] = useState(false);
  const [reportBatchId, setReportBatchId] = useState<string | undefined>();
  const [reportNote, setReportNote] = useState('');
  const [preflightOpen, setPreflightOpen] = useState(false);
  // 签名前的 AI 预检：只给建议，不阻止签名
  const [precheck, setPrecheck] = useState<AiCheckResult | null>(null);

  const precheckMutation = useMutation({
    mutationFn: () => runTaskPrecheck(tid),
    onSuccess: (result) => setPrecheck(result),
    onError: (error) =>
      setPrecheck({
        status: 'failed',
        verdict: null,
        summary: null,
        reasons: [],
        advice: [],
        markdown: null,
        model_name: null,
        error: apiError(error),
        created_at: null,
      }),
  });

  function openSignModal() {
    setSignOpen(true);
    // 打开就开始预检；模型要跑几十秒，签名按钮不等它
    setPrecheck({
      status: 'pending',
      verdict: null,
      summary: null,
      reasons: [],
      advice: [],
      markdown: null,
      model_name: null,
      error: null,
      created_at: null,
    });
    precheckMutation.mutate();
  }

  const { data: task } = useQuery({ queryKey: ['task', tid], queryFn: () => getTask(tid) });
  const { data: signoff } = useQuery({
    queryKey: ['task-signoff', tid],
    queryFn: () => getTaskSignoff(tid),
  });
  const { data: signBatches } = useQuery({
    queryKey: ['batches', 'task', tid, 'sign'],
    queryFn: () => getBatches({ task_id: tid, limit: 50 }),
    enabled: reportSignOpen,
  });

  const reportSignMutation = useMutation({
    mutationFn: () => signBatchReport(reportBatchId as string, reportNote.trim() || undefined),
    onSuccess: () => {
      message.success(t('已签章（仅该执行记录）'));
      queryClient.invalidateQueries({ queryKey: ['batch-signoff', reportBatchId] });
      setReportSignOpen(false);
      setReportBatchId(undefined);
      setReportNote('');
    },
    onError: (e) => message.error(apiError(e)),
  });

  const runMutation = useMutation({
    mutationFn: (environmentNames: string[]) => runTask(tid, environmentNames),
    onSuccess: (res) => {
      const envs = res.batches.map((b) => b.environment_name).join('、');
      if (res.batches.length > 1) {
        message.success(
          t('已提交执行：{n} 个环境（{envs}）各一条执行记录', {
            n: res.batches.length,
            envs,
          }),
        );
        navigate(`/executions?task_id=${tid}`);
        return;
      }
      message.success(
        res.run_ids.length > 1
          ? t('已提交执行：拆成 {n} 次运行（跨项目 / 用例分片）', { n: res.run_ids.length })
          : t('已提交执行（环境 {envs}）', { envs }),
      );
      navigate(`/executions/${res.batch_id}`);
    },
    onError: (e) => message.error(apiError(e)),
  });

  const invalidateSignoff = () => {
    queryClient.invalidateQueries({ queryKey: ['task-signoff', tid] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const signMutation = useMutation({
    mutationFn: (note?: string) => signTask(tid, note),
    onSuccess: () => {
      message.success(t('已签名'));
      setSignOpen(false);
      signForm.resetFields();
      invalidateSignoff();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeTaskSignoff(tid),
    onSuccess: () => {
      message.success(t('签名已撤回（记录保留）'));
      invalidateSignoff();
    },
    onError: (e) => message.error(apiError(e)),
  });

  // 与后端一致：签的是团队管理员（owner/admin）
  const role = me?.teams.find((team) => team.team_id === task?.team_id)?.role;
  const canSign = Boolean(role && role !== 'member');
  const batchOptions = (signBatches?.items ?? []).map((b) => ({
    value: b.id,
    label: `${fmtDateTime(b.started_at ?? b.created_at)} · ${batchStatusLabel(b.status)} · ${t(
      '{passed}/{total} 通过',
      { passed: b.passed, total: b.total },
    )}`,
  }));

  return (
    <ProCard
      style={{ margin: 20 }}
      title={task ? task.name : t('任务')}
      extra={
        <Space>
          {canSign && (
            <Button icon={<AuditOutlined />} onClick={() => setReportSignOpen(true)}>
              {t('报告签章')}
            </Button>
          )}
          {canSign && (
            <Button
              icon={<SafetyCertificateOutlined />}
              loading={signMutation.isPending}
              onClick={openSignModal}
            >
              {signoff?.signed ? t('重新签名') : t('测试签名')}
            </Button>
          )}
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={runMutation.isPending}
            onClick={() => setPreflightOpen(true)}
          >
            {t('立即执行')}
          </Button>
          <Link to="/tasks">{t('返回任务列表')}</Link>
        </Space>
      }
    >
      {task && (
        <ProDescriptions column={3} size="small" style={{ marginBottom: 16 }}>
          <ProDescriptions.Item label={t('类型')}>{taskTypeLabel(task.type)}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('状态')}>
            <Tag color={TASK_STATUS_COLORS[task.status]}>{taskStatusLabel(task.status)}</Tag>
          </ProDescriptions.Item>
          <ProDescriptions.Item label={t('重试次数')}>{task.retry_count}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('环境')}>{task.environment_name || t('默认')}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('质量门禁')}>
            {task.gate_enabled ? (
              <Space size={4}>
                <Tag color="blue">
                  {t('通过率 ≥ {n}%', { n: Math.round((task.gate_min_pass_rate ?? 0) * 100) })}
                </Tag>
                {task.gate_fail_on_p0 && <Tag color="red">{t('P0 失败即拒绝')}</Tag>}
              </Space>
            ) : (
              <Tag>{t('未启用')}</Tag>
            )}
          </ProDescriptions.Item>
          <ProDescriptions.Item label={t('定时')}>
            {task.schedule_enabled ? (
              <Tooltip title={t('下次 {time}', { time: fmtDateTime(task.schedule_next_run_at) })}>
                <Tag color="green">{task.schedule_cron}</Tag>
              </Tooltip>
            ) : (
              <Tag>{t('未启用')}</Tag>
            )}
          </ProDescriptions.Item>
          <ProDescriptions.Item label={t('用例选择')}>{task.case_selection_mode}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('描述')} span={2}>
            {task.description || '-'}
          </ProDescriptions.Item>
        </ProDescriptions>
      )}

      {signoff && (
        <SignoffBanner
          signoff={signoff}
          canSign={canSign}
          revoking={revokeMutation.isPending}
          onSign={() => setSignOpen(true)}
          onRevoke={() => revokeMutation.mutate()}
        />
      )}

      <Tabs
        items={[
          { key: 'cases', label: t('用例'), children: <CasesTab tid={tid} /> },
          { key: 'tags', label: t('标签'), children: <TagsTab tid={tid} teamId={task?.team_id} /> },
          { key: 'features', label: t('功能'), children: <FeaturesTab tid={tid} /> },
          { key: 'batches', label: t('执行记录'), children: <BatchesTab tid={tid} /> },
          { key: 'schedule', label: t('定时'), children: <TaskScheduleTab taskId={tid} /> },
        ]}
      />

      <PreflightModal
        open={preflightOpen}
        taskId={tid}
        taskName={task?.name}
        defaultEnvironmentName={task?.environment_name ?? undefined}
        onCancel={() => setPreflightOpen(false)}
        onRun={(environmentNames) => {
          setPreflightOpen(false);
          runMutation.mutate(environmentNames);
        }}
      />

      <Modal
        title={t('测试签名')}
        open={signOpen}
        onCancel={() => setSignOpen(false)}
        onOk={() => signForm.submit()}
        confirmLoading={signMutation.isPending}
        okText={t('确认签名')}
        forceRender
      >
        <Form form={signForm} layout="vertical" onFinish={(v) => signMutation.mutate(v.note)} preserve={false}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('签的是当前这 {n} 条用例', { n: signoff?.current_case_count ?? 0 })}
            description={t('签名会把用例集的内容指纹、你的账号和时间一起记下来。之后只要有人改了这些用例，签名会立刻变成「已失效」——这样这份签名才证明得了东西。')}
          />
          <div style={{ marginBottom: 16 }}>
            <AiInsightCard
              title={t('签名前 AI 预检')}
              check={precheck ?? undefined}
              pendingText={t('AI 正在看这批用例和最近一次执行…')}
              emptyText={t('打开签名弹窗时会自动预检')}
              extra={
                <Button
                  size="small"
                  loading={precheckMutation.isPending}
                  onClick={() => {
                    setPrecheck({ status: 'pending', verdict: null, summary: null, reasons: [], advice: [], markdown: null, model_name: null, error: null, created_at: null });
                    precheckMutation.mutate();
                  }}
                >
                  {t('重新预检')}
                </Button>
              }
            />
          </div>
          <Form.Item name="note" label={t('备注（可选）')}>
            <Input.TextArea rows={2} placeholder={t('例如：登录模块回归用例已评审通过')} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('报告签章 · 选择执行记录')}
        open={reportSignOpen}
        onCancel={() => setReportSignOpen(false)}
        onOk={() => reportSignMutation.mutate()}
        okButtonProps={{ disabled: !reportBatchId }}
        confirmLoading={reportSignMutation.isPending}
        okText={t('确认签章')}
        cancelText={t('取消')}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('一次只签一条执行记录')}
          description={t('签章只作用于你选中的那一条执行记录的报告，同一任务的其他执行记录需要分别签章。')}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={t('选择要签章的执行记录')}
            value={reportBatchId}
            onChange={setReportBatchId}
            options={batchOptions}
            notFoundContent={t('该任务还没有执行记录')}
            style={{ width: '100%' }}
          />
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            placeholder={t('签章备注（可选），例如：本次回归结论已审核')}
            value={reportNote}
            onChange={(event) => setReportNote(event.target.value)}
          />
        </div>
      </Modal>
    </ProCard>
  );
}

/** 签名状态条：没签、签了、签了但内容被改过 —— 三种状态要一眼分得清。 */
function SignoffBanner({
  signoff,
  canSign,
  revoking,
  onSign,
  onRevoke,
}: {
  signoff: TaskSignoff;
  canSign: boolean;
  revoking: boolean;
  onSign: () => void;
  onRevoke: () => void;
}) {
  if (!signoff.signed || !signoff.signoff) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('这个任务还没有人工签名')}
        description={
          canSign
            ? t('签名会把「谁、何时、签的是哪版用例」钉下来，之后可对外证明这份用例集经过了人工审核。')
            : t('签名是团队管理员的动作，你当前是普通成员。')
        }
      />
    );
  }

  const s = signoff.signoff;
  const who = s.signed_by?.display_name || s.signed_by?.username || t('已离职账号');
  return (
    <Alert
      type={signoff.stale ? 'warning' : 'success'}
      showIcon
      style={{ marginBottom: 16 }}
      message={
        signoff.stale
          ? t('签名已失效：{who} 签完之后用例被改了', { who })
          : t('已签名 · {who} · {time}', { who, time: fmtDateTime(s.signed_at) })
      }
      description={
        <>
          {s.signed_at
            ? t('签的是当时那 {n} 条用例，内容指纹 {hash}…', {
                n: s.case_count,
                hash: s.case_hash.slice(0, 12),
              })
            : ''}
          {signoff.stale
            ? t('；现在这个任务有 {n} 条用例，内容对不上，需要重新签名', {
                n: signoff.current_case_count,
              })
            : ''}
          {s.note ? t('；备注：{note}', { note: s.note }) : ''}
        </>
      }
      action={
        canSign ? (
          <Space direction="vertical">
            <Button size="small" onClick={onSign}>
              {t('重新签名')}
            </Button>
            <Popconfirm title={t('撤回后这条签名不再生效（记录保留），确定？')} onConfirm={onRevoke}>
              <Button size="small" danger loading={revoking}>
                {t('撤回')}
              </Button>
            </Popconfirm>
          </Space>
        ) : null
      }
    />
  );
}

function CasesTab({ tid }: { tid: string }) {
  const { data: cases = [], isLoading } = useQuery({ queryKey: ['task-cases', tid], queryFn: () => getTaskCases(tid) });
  return (
    <QaTable<TaskCase>
      rowKey="id"
      loading={isLoading}
      dataSource={cases}
      pagination={PAGE}
      locale={{ emptyText: t('该任务暂无关联用例') }}
      columns={[
        {
          title: t('用例'),
          dataIndex: 'name',
          sorter: byText<TaskCase>((r) => r.name),
          render: (n: string, r) => (
            <Space size={4}>
              <Link to={`/cases/${r.id}`}>{n}</Link>
              {/* 缺陷回归用例：把 bug 单号摆出来，评审时一眼看到为什么有这条 */}
              {r.defect_ids
                ? r.defect_ids
                    .split(/[,，;；\s]+/)
                    .filter(Boolean)
                    .map((id) => (
                      <Tag key={id} color="warning">
                        {id}
                      </Tag>
                    ))
                : null}
            </Space>
          ),
        },
        {
          title: t('功能'),
          dataIndex: 'feature_name',
          sorter: byText<TaskCase>((r) => r.feature_name),
          render: (v: string, r) =>
            r.feature_requirement_ids ? (
              <Space size={4}>
                <span>{v}</span>
                <Tooltip title={t('需求编号 {ids}', { ids: r.feature_requirement_ids })}>
                  <Tag>{r.feature_requirement_ids}</Tag>
                </Tooltip>
              </Space>
            ) : (
              v
            ),
        },
        {
          title: t('优先级'),
          dataIndex: 'priority',
          width: 90,
          sorter: byRank<TaskCase>((r) => r.priority ?? '', ['P0', 'P1', 'P2', 'P3']),
          render: (v: string | null) => v ?? '-',
        },
        {
          title: t('分期'),
          width: 110,
          sorter: byRank<TaskCase>((r) => r.effective_stage, ['in_iteration', 'released']),
          render: (_, r) =>
            r.effective_stage === 'released' ? <Tag color="success">{t('正式')}</Tag> : <Tag color="processing">{t('当前迭代')}</Tag>,
        },
        {
          title: t('启用'),
          dataIndex: 'is_active',
          width: 80,
          sorter: byNumber<TaskCase>((r) => (r.is_active ? 1 : 0)),
          render: (v: boolean) => (v ? t('是') : t('否')),
        },
      ]}
    />
  );
}

function TagsTab({ tid, teamId }: { tid: string; teamId?: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ tag_ids: string[] }>();

  const { data: taskTags = [], isLoading } = useQuery({ queryKey: ['task-tags', tid], queryFn: () => getTaskTags(tid) });
  const { data: teamTags = [] } = useQuery({
    queryKey: ['tags', teamId],
    queryFn: () => getTagsByTeam(teamId!),
    enabled: !!teamId,
  });

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) => setTaskTags(tid, ids),
    onSuccess: () => {
      message.success(t('标签已更新'));
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['task-tags', tid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <div>
      <Button
        type="primary"
        style={{ marginBottom: 16 }}
        onClick={() => {
          form.setFieldsValue({ tag_ids: taskTags.map((tag) => tag.id) });
          setOpen(true);
        }}
      >
        {t('设置标签')}
      </Button>
      <QaTable<TaskTag>
        rowKey="id"
        loading={isLoading}
        dataSource={taskTags}
        pagination={PAGE}
        locale={{ emptyText: t('暂无标签') }}
        columns={[
          {
            title: t('名称'),
            dataIndex: 'name',
            sorter: byText<TaskTag>((r) => r.name),
            render: (n: string, r) => <Tag color={r.color ?? undefined}>{n}</Tag>,
          },
          {
            title: t('颜色'),
            dataIndex: 'color',
            sorter: byText<TaskTag>((r) => r.color),
            render: (v: string | null) => v || '-',
          },
        ]}
      />
      <Modal
        title={t('设置标签')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        forceRender
      >
        <Form form={form} onFinish={(v) => saveMutation.mutate(v.tag_ids ?? [])} preserve={false}>
          <Form.Item name="tag_ids" label={t('标签')}>
            <Select
              mode="multiple"
              allowClear
              placeholder={t('选择标签')}
              options={teamTags.map((tag) => ({ value: tag.id, label: tag.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function BatchesTab({ tid }: { tid: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['batches', 'task', tid],
    queryFn: () => getBatches({ task_id: tid, limit: 100 }),
    refetchInterval: (q) =>
      q.state.data?.items.some((b) => b.status === 'running') ? 3000 : false,
  });
  const batches = data?.items ?? [];

  return (
    <QaTable<Batch>
      rowKey="id"
      loading={isLoading}
      dataSource={batches}
      pagination={PAGE}
      locale={{ emptyText: t('该任务还没执行过') }}
      onRow={(r) => ({
        style: { cursor: 'pointer' },
        onClick: () => navigate(`/executions/${r.id}`),
      })}
      columns={[
        {
          title: t('开始时间'),
          width: 170,
          sorter: byDate<Batch>((r) => r.started_at ?? r.created_at),
          render: (_, r) => fmtDateTime(r.started_at ?? r.created_at),
        },
        {
          title: t('环境'),
          width: 100,
          sorter: byText<Batch>((r) => r.environment_name ?? ''),
          render: (_, r) =>
            r.environment_name ? <Tag>{r.environment_name}</Tag> : '-',
        },
        {
          title: t('状态'),
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
              {batchStatusLabel(r.status)}
            </Tag>
          ),
        },
        {
          title: t('通过 / 总数'),
          width: 120,
          sorter: byNumber<Batch>((r) => (r.total ? r.passed / r.total : -1)),
          render: (_, r) => (r.total === 0 ? '-' : `${r.passed}/${r.total}`),
        },
        {
          title: t('功能'),
          render: (_, r) =>
            r.features.length === 0 ? (
              '-'
            ) : (
              <Space size={4} wrap>
                {r.features.map((f) => (
                  <Tag key={f.feature_id} color={f.failed > 0 ? 'error' : 'success'}>
                    {f.name} {f.passed}/{f.total}
                  </Tag>
                ))}
              </Space>
            ),
        },
        { title: t('耗时'), width: 90, sorter: byNumber<Batch>((r) => r.duration_ms), render: (_, r) => fmtDuration(r.duration_ms) },
        {
          title: t('操作'),
          width: 150,
          render: (_, r) => (
            <Space size={12}>
              <Link to={`/executions/${r.id}`} onClick={(event) => event.stopPropagation()}>
                {t('详情')}
              </Link>
              {r.status !== 'running' && r.status !== 'empty' && (
                <Link
                  to={`/executions/${r.id}/report`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {t('测试报告')}
                </Link>
              )}
            </Space>
          ),
        },
      ]}
    />
  );
}

/** 任务由哪些功能组合而成 —— 「一个任务就是一堆功能的组合」在界面上要看得见。 */
function FeaturesTab({ tid }: { tid: string }) {
  const { data: features = [], isLoading } = useQuery({
    queryKey: ['task-features', tid],
    queryFn: () => getTaskFeatures(tid),
  });

  return (
    <QaTable<TaskFeature>
      rowKey="id"
      loading={isLoading}
      dataSource={features}
      pagination={PAGE}
      locale={{ emptyText: t('这个任务还没选功能。编辑任务即可添加。') }}
      columns={[
        {
          title: t('功能'),
          dataIndex: 'name',
          sorter: byText<TaskFeature>((r) => r.name),
          render: (v: string, r) => <Link to={`/features/${r.id}`}>{v}</Link>,
        },
        {
          title: t('所属项目'),
          dataIndex: 'project_name',
          sorter: byText<TaskFeature>((r) => r.project_name),
        },
        {
          title: t('分期'),
          width: 110,
          dataIndex: 'stage',
          sorter: byRank<TaskFeature>((r) => r.stage, ['in_iteration', 'released']),
          render: (s: string) =>
            s === 'released' ? <Tag color="success">{t('正式')}</Tag> : <Tag color="processing">{t('当前迭代')}</Tag>,
        },
      ]}
    />
  );
}