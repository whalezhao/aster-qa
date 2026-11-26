import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Col, Modal, Progress, Row, Space, Spin, Statistic, Tabs, Tag } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import {
  cancelRun,
  downloadRunFile,
  getRun,
  getRunCases,
  getRunDownloads,
  isRunActive,
  reparseRun,
  rerunFailedRun,
} from '../api/runs';
import { getCaseVersion } from '../api/caseVersions';
import { apiError } from '../api/client';
import { t } from '../i18n';
import { fmtDateTime, fmtDuration, fmtPercent, fmtTokens, runStatusView } from '../lib/format';
import { PAGE, byNumber, byRank, byText } from '../lib/table';
import type { RunCase } from '../api/types';
import QaTable from '../components/QaTable';
import AiFixModal from '../components/AiFixModal';
import YamlPreview from '../components/YamlPreview';
import { RunReportView } from '../components/report/ReportView';

export default function RunDetail() {
  const { rid = '' } = useParams();
  // 支持 ?tab=report 深链：从执行批次或用例历史点「报告」要直接落到报告页签
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'cases' | 'report'>(
    tabParam === 'report' ? 'report' : 'cases',
  );
  // URL 变了就跟着变；用户点页签只改本地状态，不受 URL 反向覆盖
  useEffect(() => {
    setActiveTab(tabParam === 'report' ? 'report' : 'cases');
  }, [tabParam]);
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', rid],
    queryFn: () => getRun(rid),
    refetchInterval: (query) => (query.state.data && isRunActive(query.state.data.status) ? 3000 : false),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(rid),
    onSuccess: (res) => {
      message.success(
        res.status === 'cancelling' ? t('正在取消，worker 会尽快终止进程') : t('已取消'),
      );
      queryClient.invalidateQueries({ queryKey: ['run', rid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const reparseMutation = useMutation({
    mutationFn: () => reparseRun(rid),
    onSuccess: (res) => {
      message.success(t('已重新解析，重建 {n} 条用例结果', { n: res.cases }));
      queryClient.invalidateQueries({ queryKey: ['run', rid] });
      queryClient.invalidateQueries({ queryKey: ['run-cases', rid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const rerunFailed = useMutation({
    mutationFn: () => rerunFailedRun(rid),
    onSuccess: (res) => {
      message.success(
        run?.run_kind === 'flow'
          ? t('已提交重跑 {n} 个失败/阻塞用例', { n: res.case_count })
          : t('已提交重跑 {n} 个失败用例', { n: res.case_count }),
      );
      navigate(`/executions/${res.batch_id}`);
    },
    onError: (e) => message.error(apiError(e)),
  });

  if (isLoading || !run) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const view = runStatusView(run);
  const active = isRunActive(run.status);

  return (
    <ProCard
      style={{ margin: 20 }}
      title={
        <Space>
          <span>{t('执行详情')}</span>
          <Tag color={view.color}>{view.label}</Tag>
          {run.midscene_status && <Tag>{t('执行器: {status}', { status: run.midscene_status })}</Tag>}
        </Space>
      }
      extra={
        <Space>
          {!active && (run.failed ?? 0) > 0 && (
            <Button
              loading={rerunFailed.isPending}
              onClick={() => {
                if (run.run_kind !== 'flow') {
                  rerunFailed.mutate();
                  return;
                }
                modal.confirm({
                  title: t('重跑本批次的失败/阻塞节点？'),
                  content: t(
                    '会按依赖关系重跑失败/阻塞节点；已成功的前置不会重跑。',
                  ),
                  onOk: () => rerunFailed.mutateAsync(),
                });
              }}
            >
              {run.run_kind === 'flow'
                ? t('重跑失败/阻塞节点')
                : t('仅重跑失败用例')}
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={reparseMutation.isPending}
            onClick={() => reparseMutation.mutate()}
          >
            {t('重新解析')}
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            disabled={!active}
            loading={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            {t('取消执行')}
          </Button>
          <Link to="/runs">{t('返回列表')}</Link>
        </Space>
      }
    >
      {run.error_message &&
        (run.status === 'blocked' ? (
          <Alert
            type="warning"
            showIcon
            message={t('被前置用例阻塞')}
            description={run.error_message}
            style={{ marginBottom: 16 }}
          />
        ) : run.status === 'skipped' ? (
          <Alert
            type="info"
            showIcon
            message={t('条件跳过')}
            description={run.error_message}
            style={{ marginBottom: 16 }}
          />
        ) : (
          <Alert
            type="error"
            showIcon
            message={t('执行报错')}
            description={run.error_message}
            style={{ marginBottom: 16 }}
          />
        ))}

      {run.depends_on_run_ids.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('前置执行')}
          description={
            <Space wrap>
              {run.depends_on_run_ids.map((runId) => (
                <Link key={runId} to={`/runs/${runId}`}>
                  {runId.slice(0, 8)}
                </Link>
              ))}
            </Space>
          }
        />
      )}

      {active && (
        <ProCard size="small" style={{ marginBottom: 16 }} title={t('执行进度（每 3 秒自动刷新）')}>
          <Progress
            percent={run.progress.percent}
            status="active"
            format={(p) =>
              t('{done}/{total}（{percent}%）', {
                done: run.progress.done,
                total: run.progress.total,
                percent: p ?? 0,
              })
            }
          />
        </ProCard>
      )}

      {/* 主要指标只留 5 个一行摆满；AI 相关和元信息下沉到下面的描述列表，避免 9 个卡片换行错位 */}
      <Row gutter={16}>
        <Col span={5}>
          <Statistic
            title={t('通过 / 总数')}
            value={run.total === null ? '-' : `${run.passed ?? 0}/${run.total}`}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title={t('失败')}
            value={run.failed ?? 0}
            valueStyle={{ color: (run.failed ?? 0) > 0 ? '#faad14' : undefined }}
          />
        </Col>
        <Col span={5}>
          <Statistic title={t('最终通过率')} value={fmtPercent(run.final_pass_rate)} />
        </Col>
        <Col span={5}>
          <Statistic title={t('首次通过率')} value={fmtPercent(run.first_pass_rate)} />
        </Col>
        <Col span={5}>
          <Statistic title={t('耗时')} value={fmtDuration(run.duration_ms)} />
        </Col>
      </Row>

      <ProDescriptions column={3} size="small" style={{ marginTop: 20 }}>
        <ProDescriptions.Item label={t('重试后通过')}>{run.passed_after_retry ?? 0}</ProDescriptions.Item>
        <ProDescriptions.Item label={t('AI 调用')}>{t('{n} 次', { n: run.ai_calls })}</ProDescriptions.Item>
        <ProDescriptions.Item label={t('Token 用量')}>{fmtTokens(run.ai_total_tokens)}</ProDescriptions.Item>
        <ProDescriptions.Item label={t('AI 耗时')}>{fmtDuration(run.ai_cost_ms)}</ProDescriptions.Item>
        <ProDescriptions.Item label={t('模型')}>{run.model_name || '-'}</ProDescriptions.Item>
        <ProDescriptions.Item label={t('环境')}>
          {run.environment_name
            ? `${run.environment_name}${run.environment_base_url ? ` · ${run.environment_base_url}` : ''}`
            : t('默认')}
        </ProDescriptions.Item>
        <ProDescriptions.Item label={t('退出码')}>{run.exit_code ?? '-'}</ProDescriptions.Item>
        <ProDescriptions.Item label="Run ID">{run.id}</ProDescriptions.Item>
        <ProDescriptions.Item label={t('任务')}>
          {run.task_id ? <Link to={`/tasks/${run.task_id}`}>{run.task_id.slice(0, 8)}</Link> : '-'}
        </ProDescriptions.Item>
        <ProDescriptions.Item label={t('开始')}>{fmtDateTime(run.started_at)}</ProDescriptions.Item>
        <ProDescriptions.Item label={t('结束')}>{fmtDateTime(run.ended_at)}</ProDescriptions.Item>
      </ProDescriptions>

      <RunDownloads rid={rid} active={active} />

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key === 'report' ? 'report' : 'cases')}
        style={{ marginTop: 16 }}
        items={[
          { key: 'cases', label: t('用例结果'), children: <CasesTab rid={rid} /> },
          {
            key: 'report',
            label: t('报告'),
            children: <RunReportView runId={rid} available={run.report_available} />,
          },
        ]}
      />
    </ProCard>
  );
}

function RunDownloads({ rid, active }: { rid: string; active: boolean }) {
  const { message } = App.useApp();
  const { data: files = [] } = useQuery({
    queryKey: ['run-downloads', rid],
    queryFn: () => getRunDownloads(rid),
    refetchInterval: active ? 5000 : false,
  });
  const download = useMutation({
    mutationFn: (name: string) => downloadRunFile(rid, name),
    onError: (e) => message.error(apiError(e)),
  });
  if (files.length === 0) return null;
  return (
    <ProCard size="small" title={t('下载产物')} style={{ marginTop: 16 }}>
      <Space wrap>
        {files.map((file) => (
          <Button
            key={file.name}
            size="small"
            loading={download.isPending}
            onClick={() => download.mutate(file.name)}
          >
            {file.name}（{(file.size / 1024).toFixed(1)} KB）
          </Button>
        ))}
      </Space>
    </ProCard>
  );
}

function CasesTab({ rid }: { rid: string }) {
  const [fixing, setFixing] = useState<{ id: string; name: string } | null>(null);
  const [versionFor, setVersionFor] = useState<{
    caseId: string;
    versionId: string;
    versionNo: number | null;
    name: string;
  } | null>(null);
  const { data: cases = [], isLoading } = useQuery({
    queryKey: ['run-cases', rid],
    queryFn: () => getRunCases(rid),
    refetchInterval: 5000,
  });

  return (
    <>
      <QaTable<RunCase>
        rowKey="id"
        loading={isLoading}
        dataSource={cases}
        pagination={PAGE}
        locale={{ emptyText: t('暂无用例结果') }}
        columns={[
          {
            title: '#',
            dataIndex: 'case_index',
            width: 60,
            sorter: byNumber<RunCase>((r) => r.case_index),
          },
          { title: t('用例'), dataIndex: 'name', sorter: byText<RunCase>((r) => r.name) },
          {
            title: t('执行版本'),
            dataIndex: 'test_case_version_no',
            width: 110,
            render: (value: number | null, row) =>
              row.test_case_id && row.test_case_version_id ? (
                <Button
                  size="small"
                  type="link"
                  onClick={() =>
                    setVersionFor({
                      caseId: row.test_case_id!,
                      versionId: row.test_case_version_id!,
                      versionNo: value,
                      name: row.name,
                    })
                  }
                >
                  {value ? t('查看 v{n}', { n: value }) : t('查看')}
                </Button>
              ) : (
                '-'
              ),
          },
          {
            title: t('结果'),
            dataIndex: 'status',
            width: 110,
            sorter: byRank<RunCase>((r) => r.status, ['passed', 'failed', 'blocked']),
            render: (s: string, row) => (
              <Tag
                color={
                  s === 'passed'
                    ? 'success'
                    : s === 'failed'
                      ? 'error'
                      : s === 'blocked'
                        ? 'warning'
                        : s === 'skipped'
                          ? 'default'
                          : 'default'
                }
                title={row.blocked_reason ?? undefined}
              >
                {s === 'blocked'
                  ? t('被前置用例阻塞')
                  : s === 'skipped'
                    ? t('条件跳过')
                    : s}
              </Tag>
            ),
          },
          {
            title: t('尝试次数'),
            dataIndex: 'attempt_count',
            width: 100,
            sorter: byNumber<RunCase>((r) => r.attempt_count),
          },
          {
            title: t('重试后通过'),
            dataIndex: 'passed_after_retry',
            width: 110,
            sorter: byNumber<RunCase>((r) => (r.passed_after_retry ? 1 : 0)),
            render: (v: boolean) => (v ? <Tag color="warning">{t('是')}</Tag> : t('否')),
          },
          {
            title: t('操作'),
            width: 110,
            render: (_value, row) =>
              row.status !== 'success' && row.test_case_id ? (
                <Button
                  size="small"
                  onClick={() => setFixing({ id: row.test_case_id!, name: row.name })}
                >
                  {t('AI 修复')}
                </Button>
              ) : (
                '-'
              ),
          },
        ]}
      />
      <AiFixModal
        open={Boolean(fixing)}
        caseId={fixing?.id ?? ''}
        caseName={fixing?.name}
        onClose={() => setFixing(null)}
      />
      <ExecutionVersionModal target={versionFor} onClose={() => setVersionFor(null)} />
    </>
  );
}

function ExecutionVersionModal({
  target,
  onClose,
}: {
  target: {
    caseId: string;
    versionId: string;
    versionNo: number | null;
    name: string;
  } | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['case-version', target?.caseId, target?.versionId],
    queryFn: () => getCaseVersion(target!.caseId, target!.versionId),
    enabled: Boolean(target),
  });
  return (
    <Modal
      open={Boolean(target)}
      title={t('执行版本 v{n} · {name}', {
        n: target?.versionNo ?? '?',
        name: target?.name ?? '',
      })}
      width={860}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t('关闭')}</Button>}
    >
      {error ? (
        <Alert type="error" showIcon message={apiError(error)} />
      ) : (
        <Spin spinning={isLoading}>
          <YamlPreview code={data?.yaml_content ?? ''} />
        </Spin>
      )}
    </Modal>
  );
}