import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Col, Progress, Row, Space, Spin, Statistic, Tabs, Tag } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { cancelRun, getRun, getRunCases, isRunActive, reparseRun, rerunFailedRun } from '../api/runs';
import { apiError } from '../api/client';
import { fmtDateTime, fmtDuration, fmtPercent, fmtTokens, runStatusView } from '../lib/format';
import { PAGE, byNumber, byRank, byText } from '../lib/table';
import type { RunCase } from '../api/types';
import QaTable from '../components/QaTable';
import AiFixModal from '../components/AiFixModal';
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
  const { message } = App.useApp();
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
      message.success(res.status === 'cancelling' ? '正在取消，worker 会尽快终止进程' : '已取消');
      queryClient.invalidateQueries({ queryKey: ['run', rid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const reparseMutation = useMutation({
    mutationFn: () => reparseRun(rid),
    onSuccess: (res) => {
      message.success(`已重新解析，重建 ${res.cases} 条用例结果`);
      queryClient.invalidateQueries({ queryKey: ['run', rid] });
      queryClient.invalidateQueries({ queryKey: ['run-cases', rid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const rerunFailed = useMutation({
    mutationFn: () => rerunFailedRun(rid),
    onSuccess: (res) => {
      message.success(`已提交重跑 ${res.case_count} 个失败用例`);
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
          <span>执行详情</span>
          <Tag color={view.color}>{view.label}</Tag>
          {run.midscene_status && <Tag>执行器: {run.midscene_status}</Tag>}
        </Space>
      }
      extra={
        <Space>
          {!active && (run.failed ?? 0) > 0 && (
            <Button loading={rerunFailed.isPending} onClick={() => rerunFailed.mutate()}>
              仅重跑失败用例
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={reparseMutation.isPending}
            onClick={() => reparseMutation.mutate()}
          >
            重新解析
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            disabled={!active}
            loading={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            取消执行
          </Button>
          <Link to="/runs">返回列表</Link>
        </Space>
      }
    >
      {run.error_message && (
        <Alert type="error" showIcon message="执行报错" description={run.error_message} style={{ marginBottom: 16 }} />
      )}

      {active && (
        <ProCard size="small" style={{ marginBottom: 16 }} title="执行进度（每 3 秒自动刷新）">
          <Progress
            percent={run.progress.percent}
            status="active"
            format={(p) => `${run.progress.done}/${run.progress.total}（${p}%）`}
          />
        </ProCard>
      )}

      {/* 主要指标只留 5 个一行摆满；AI 相关和元信息下沉到下面的描述列表，避免 9 个卡片换行错位 */}
      <Row gutter={16}>
        <Col span={5}>
          <Statistic
            title="通过 / 总数"
            value={run.total === null ? '-' : `${run.passed ?? 0}/${run.total}`}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title="失败"
            value={run.failed ?? 0}
            valueStyle={{ color: (run.failed ?? 0) > 0 ? '#faad14' : undefined }}
          />
        </Col>
        <Col span={5}>
          <Statistic title="最终通过率" value={fmtPercent(run.final_pass_rate)} />
        </Col>
        <Col span={5}>
          <Statistic title="首次通过率" value={fmtPercent(run.first_pass_rate)} />
        </Col>
        <Col span={5}>
          <Statistic title="耗时" value={fmtDuration(run.duration_ms)} />
        </Col>
      </Row>

      <ProDescriptions column={3} size="small" style={{ marginTop: 20 }}>
        <ProDescriptions.Item label="重试后通过">{run.passed_after_retry ?? 0}</ProDescriptions.Item>
        <ProDescriptions.Item label="AI 调用">{run.ai_calls} 次</ProDescriptions.Item>
        <ProDescriptions.Item label="Token 用量">{fmtTokens(run.ai_total_tokens)}</ProDescriptions.Item>
        <ProDescriptions.Item label="AI 耗时">{fmtDuration(run.ai_cost_ms)}</ProDescriptions.Item>
        <ProDescriptions.Item label="模型">{run.model_name || '-'}</ProDescriptions.Item>
        <ProDescriptions.Item label="环境">
          {run.environment_name
            ? `${run.environment_name}${run.environment_base_url ? ` · ${run.environment_base_url}` : ''}`
            : '默认'}
        </ProDescriptions.Item>
        <ProDescriptions.Item label="退出码">{run.exit_code ?? '-'}</ProDescriptions.Item>
        <ProDescriptions.Item label="Run ID">{run.id}</ProDescriptions.Item>
        <ProDescriptions.Item label="任务">
          {run.task_id ? <Link to={`/tasks/${run.task_id}`}>{run.task_id.slice(0, 8)}</Link> : '-'}
        </ProDescriptions.Item>
        <ProDescriptions.Item label="开始">{fmtDateTime(run.started_at)}</ProDescriptions.Item>
        <ProDescriptions.Item label="结束">{fmtDateTime(run.ended_at)}</ProDescriptions.Item>
      </ProDescriptions>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key === 'report' ? 'report' : 'cases')}
        style={{ marginTop: 16 }}
        items={[
          { key: 'cases', label: '用例结果', children: <CasesTab rid={rid} /> },
          {
            key: 'report',
            label: '报告',
            children: <RunReportView runId={rid} available={run.report_available} />,
          },
        ]}
      />
    </ProCard>
  );
}

function CasesTab({ rid }: { rid: string }) {
  const [fixing, setFixing] = useState<{ id: string; name: string } | null>(null);
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
        locale={{ emptyText: '暂无用例结果' }}
        columns={[
          {
            title: '#',
            dataIndex: 'case_index',
            width: 60,
            sorter: byNumber<RunCase>((r) => r.case_index),
          },
          { title: '用例', dataIndex: 'name', sorter: byText<RunCase>((r) => r.name) },
          {
            title: '结果',
            dataIndex: 'status',
            width: 110,
            sorter: byRank<RunCase>((r) => r.status, ['passed', 'failed']),
            render: (s: string) => (
              <Tag color={s === 'passed' ? 'success' : s === 'failed' ? 'error' : 'default'}>{s}</Tag>
            ),
          },
          {
            title: '尝试次数',
            dataIndex: 'attempt_count',
            width: 100,
            sorter: byNumber<RunCase>((r) => r.attempt_count),
          },
          {
            title: '重试后通过',
            dataIndex: 'passed_after_retry',
            width: 110,
            sorter: byNumber<RunCase>((r) => (r.passed_after_retry ? 1 : 0)),
            render: (v: boolean) => (v ? <Tag color="warning">是</Tag> : '否'),
          },
          {
            title: '操作',
            width: 110,
            render: (_value, row) =>
              row.status !== 'success' && row.test_case_id ? (
                <Button
                  size="small"
                  onClick={() => setFixing({ id: row.test_case_id!, name: row.name })}
                >
                  AI 修复
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
    </>
  );
}
