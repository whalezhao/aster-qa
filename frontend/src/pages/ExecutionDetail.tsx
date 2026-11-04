import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Breadcrumb, Button, Col, Empty, Progress, Row, Space, Statistic, Tag, Tooltip, Typography, theme } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { FileTextOutlined, TrophyOutlined } from '@ant-design/icons';
import { getBatch, rerunFailedBatch, type BatchDetail, type BatchFeature, type BatchRun } from '../api/batches';
import { useActiveTeam } from '../team/TeamContext';
import { t } from '../i18n';
import {
  BATCH_STATUS_COLORS,
  batchStatusLabel,
  fmtDateTime,
  fmtDuration,
  fmtPercent,
  runStatusView,
  taskTypeLabel,
} from '../lib/format';
import { PAGE, byNumber, byRank, byText } from '../lib/table';
import { getBatchCheck, rerunBatchCheck } from '../api/ai';
import { apiError } from '../api/client';
import AiInsightCard from '../components/AiInsightCard';
import QaTable from '../components/QaTable';

const ACTIVE = ['running'];

export default function ExecutionDetail() {
  const { bid = '' } = useParams();
  const navigate = useNavigate();
  useActiveTeam();

  const { data: batch, isLoading } = useQuery({
    queryKey: ['batch', bid],
    queryFn: () => getBatch(bid),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 3000 : false),
  });
  // AI 评估是异步的：pending 时轮询，done 后停
  const { data: aiCheck } = useQuery({
    queryKey: ['batch-ai-check', bid],
    queryFn: () => getBatchCheck(bid),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 4000 : false),
  });

  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const rerun = useMutation({
    mutationFn: () => rerunBatchCheck(bid),
    onSuccess: (check) => {
      // 写回 pending 状态，上面的轮询会自动接着跑
      queryClient.setQueryData(['batch-ai-check', bid], check);
      message.success(t('已提交重新评估'));
    },
    onError: (e) => message.error(apiError(e)),
  });

  const rerunFailed = useMutation({
    mutationFn: () => rerunFailedBatch(bid),
    onSuccess: (res) => {
      message.success(t('已提交重跑 {n} 个失败用例', { n: res.case_count }));
      queryClient.invalidateQueries({ queryKey: ['batch', bid] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      navigate(`/executions/${res.batch_id}`);
    },
    onError: (e) => message.error(apiError(e)),
  });

  if (isLoading || !batch) {
    return <ProCard loading />;
  }

  const running = ACTIVE.includes(batch.status);
  const percent = batch.total > 0 ? Math.round((batch.passed + batch.failed) * 100 / batch.total) : 0;
  // 全绿批次不调 AI：用奖杯卡片收尾，省一次模型调用也更有「跑完了」的感觉
  const allPassed = batch.total > 0 && batch.failed === 0 && batch.passed === batch.total;

  return (
    <div style={{ padding: 20 }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/executions">{t('执行记录')}</Link> },
          { title: batch.name },
        ]}
      />

      <ProCard
        title={
          <Space>
            <span>{batch.name}</span>
            <Tag color={BATCH_STATUS_COLORS[batch.status] ?? 'default'}>
              {batchStatusLabel(batch.status)}
            </Tag>
            {batch.excluded_runs > 0 && (
              <Tooltip title={t('这些执行里的用例失败不是用例本身的问题（模型额度/配置/网络），不计入通过率')}>
                <Tag>{t('{n} 次未计入统计', { n: batch.excluded_runs })}</Tag>
              </Tooltip>
            )}
          </Space>
        }
        extra={
          <Space>
            {!running && batch.failed > 0 && (
              <Button
                loading={rerunFailed.isPending}
                onClick={() =>
                  modal.confirm({
                    title: t('只重跑 {n} 个失败用例？', { n: batch.failed }),
                    content: t('会创建一个新批次，并沿用本次执行的环境；一个 YAML 里的其他用例也会一起再跑。'),
                    onOk: () => rerunFailed.mutateAsync(),
                  })
                }
              >
                {t('仅重跑失败用例')}
              </Button>
            )}
            <Button
              icon={<FileTextOutlined />}
              onClick={() => navigate(`/executions/${bid}/report`)}
            >
              {t('测试报告')}
            </Button>
            {batch.task_id ? <Link to={`/tasks/${batch.task_id}`}>{t('查看任务')}</Link> : null}
          </Space>
        }
      >
        <ProDescriptions column={3} size="small">
          <ProDescriptions.Item label={t('测试任务')}>
            {batch.task_id && batch.task_name ? (
              <Space direction="vertical" size={0}>
                <Link to={`/tasks/${batch.task_id}`}>{batch.task_name}</Link>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {taskTypeLabel(batch.task_type ?? '')}
                  {batch.task_case_count ? t(' · {n} 个用例', { n: batch.task_case_count }) : ''}
                  {batch.task_feature_count ? t(' · {n} 个功能', { n: batch.task_feature_count }) : ''}
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">-</Typography.Text>
            )}
          </ProDescriptions.Item>
          <ProDescriptions.Item label={t('开始')}>{fmtDateTime(batch.started_at)}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('结束')}>{fmtDateTime(batch.ended_at)}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('耗时')}>{fmtDuration(batch.duration_ms)}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('系统数')}>{batch.project_count}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('触发方式')}>
            {t(
              {
                manual: '手动',
                regression: '回归',
                rerun: '重跑失败',
                schedule: '定时',
                ci: 'CI',
              }[batch.trigger] ?? batch.trigger,
            )}
          </ProDescriptions.Item>
          <ProDescriptions.Item label={t('环境')}>{batch.environment_name || t('默认')}</ProDescriptions.Item>
          <ProDescriptions.Item label={t('执行 ID')}>
            <Typography.Text copyable style={{ fontSize: 12 }}>
              {batch.id}
            </Typography.Text>
          </ProDescriptions.Item>
        </ProDescriptions>

        {batch.gate_detail && batch.gate_detail.status !== 'disabled' && (
          <Alert
            style={{ marginTop: 12 }}
            type={
              batch.gate_detail.status === 'failed'
                ? 'error'
                : batch.gate_detail.status === 'pending'
                  ? 'info'
                  : batch.gate_detail.status === 'no_data'
                    ? 'warning'
                    : 'success'
            }
            showIcon
            message={
              batch.gate_detail.status === 'failed'
                ? t('质量门禁未通过')
                : batch.gate_detail.status === 'pending'
                  ? t('质量门禁待执行完成')
                  : batch.gate_detail.status === 'no_data'
                    ? t('质量门禁无有效执行')
                    : t('质量门禁通过')
            }
            description={
              batch.gate_detail.reasons.length
                ? batch.gate_detail.reasons.join('；')
                : t('通过率 {rate}', { rate: fmtPercent((batch.gate_detail.pass_rate ?? 0) * 100) })
            }
          />
        )}

        {running && (
          <>
            <Progress percent={percent} status="active" style={{ marginTop: 16 }} />
            <Typography.Text type="secondary">
              {t('执行中，页面每 3 秒自动刷新。单用例通常要 40 秒到几分钟。')}
            </Typography.Text>
          </>
        )}

        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={6}>
            <Statistic title={t('用例通过')} value={`${batch.passed}/${batch.total}`} />
          </Col>
          <Col span={6}>
            <Statistic
              title={t('失败')}
              value={batch.failed}
              valueStyle={{ color: batch.failed > 0 ? '#faad14' : undefined }}
            />
          </Col>
          <Col span={6}>
            <Statistic title={t('通过率')} value={fmtPercent(batch.total ? batch.passed / batch.total : null)} />
          </Col>
          <Col span={6}>
            <Statistic title={t('涉及系统')} value={batch.project_count} />
          </Col>
        </Row>
      </ProCard>

      <div style={{ marginTop: 16 }}>
        {allPassed ? (
          <AllPassedCard batch={batch} />
        ) : (
          <AiInsightCard
            title={t('AI 评估')}
            check={aiCheck}
            pendingText={t('AI 正在读这次执行的产物和失败步骤…')}
            emptyText={t('这次执行完成后会自动生成 AI 评估')}
            extra={
              <Button size="small" loading={rerun.isPending} onClick={() => rerun.mutate()}>
                {t('重新评估')}
              </Button>
            }
          />
        )}
      </div>

      <ProCard title={t('各功能结果')} style={{ marginTop: 16 }}>
        {batch.features.length === 0 ? (
          <Empty description={t('这次执行没有产生功能维度的结果')} />
        ) : (
          <QaTable<BatchFeature>
            rowKey="feature_id"
            dataSource={batch.features}
            pagination={PAGE}
            size="small"
            columns={[
              {
                title: t('功能'),
                dataIndex: 'name',
                sorter: byText<BatchFeature>((f) => f.name),
              },
              {
                title: t('分期'),
                dataIndex: 'stage',
                width: 100,
                sorter: byRank<BatchFeature>((f) => f.stage, ['in_iteration', 'released']),
                render: (s: string) =>
                  s === 'released' ? <Tag color="success">{t('正式')}</Tag> : <Tag color="processing">{t('当前迭代')}</Tag>,
              },
              {
                title: t('通过'),
                width: 160,
                sorter: byNumber<BatchFeature>((f) => (f.total ? f.passed / f.total : 0)),
                render: (_, f) => (
                  <Space>
                    <Typography.Text type={f.failed > 0 ? 'warning' : undefined}>
                      {f.passed}/{f.total}
                    </Typography.Text>
                    <Progress
                      percent={f.total ? Math.round((f.passed * 100) / f.total) : 0}
                      size="small"
                      style={{ width: 80, marginBottom: 0 }}
                      status={f.failed > 0 ? 'exception' : 'success'}
                    />
                  </Space>
                ),
              },
            ]}
          />
        )}
      </ProCard>

      <ProCard title={t('各系统的执行明细')} style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">
          {t('跨系统或用例分片的任务会拆成多次运行（一个 run 只跑一个系统的一部分用例），下面是每一份运行的结果。点「报告」查看该系统报告；需要归档签章时用右上角的「测试报告」。')}
        </Typography.Paragraph>
        {batch.run_items.length === 0 ? (
          <Empty description={t('没有运行明细')} />
        ) : (
          <QaTable<BatchRun>
            rowKey="id"
            dataSource={batch.run_items}
            pagination={PAGE}
            size="small"
            columns={[
              {
                title: t('系统'),
                dataIndex: 'project_name',
                sorter: byText<BatchRun>((r) => r.project_name),
                render: (v: string | null, r) => (
                  <Space size={6}>
                    {v ? <Link to={`/projects/${r.project_id}`}>{v}</Link> : '-'}
                    {r.shard_count !== null && r.shard_count > 1 && (
                      <Tag>
                        {t('分片 {index}/{count}', { index: r.shard_index ?? 0, count: r.shard_count })}
                      </Tag>
                    )}
                  </Space>
                ),
              },
              {
                title: t('状态'),
                width: 150,
                sorter: byRank<BatchRun>((r) => r.status, [
                  'queued',
                  'preparing',
                  'running',
                  'succeeded',
                  'failed',
                  'cancelled',
                ]),
                render: (_, r) => {
                  const view = runStatusView({
                    status: r.status,
                    failed: r.failed,
                    failure_kind: r.failure_kind,
                  });
                  return <Tag color={view.color}>{view.label}</Tag>;
                },
              },
              {
                title: t('通过 / 总数'),
                width: 110,
                sorter: byNumber<BatchRun>((r) => (r.total ? (r.passed ?? 0) / r.total : -1)),
                render: (_, r) => (r.total === null ? '-' : `${r.passed ?? 0}/${r.total}`),
              },
              {
                title: t('耗时'),
                width: 90,
                sorter: byNumber<BatchRun>((r) => r.duration_ms),
                render: (_, r) => fmtDuration(r.duration_ms),
              },
              {
                title: t('模型'),
                width: 150,
                sorter: byText<BatchRun>((r) => r.model_name),
                render: (_, r) => r.model_name || '-',
              },
              {
                title: t('操作'),
                width: 200,
                render: (_, r) => (
                  <Space>
                    <Button
                      size="small"
                      icon={<FileTextOutlined />}
                      disabled={!r.report_available}
                      onClick={() => navigate(`/runs/${r.id}?tab=report`)}
                    >
                      {t('报告')}
                    </Button>
                    <Button size="small" onClick={() => navigate(`/runs/${r.id}`)}>
                      {t('用例结果')}
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </ProCard>

      {batch.failed > 0 && batch.excluded_runs === 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message={t('有用例失败')}
          description={t('用例由 AI 驱动执行，同一个用例时过时不过属于常态，单次失败不等价于缺陷。建议结合「用例历史执行结果」判断是否稳定复现。')}
        />
      )}
    </div>
  );
}

/** 全绿批次的收尾卡片：奖杯 + 100% 圆环。全绿不调 AI，失败才做逐条诊断。 */
function AllPassedCard({ batch }: { batch: BatchDetail }) {
  const { token } = theme.useToken();
  return (
    <div
      className="qa-all-passed"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '22px 26px',
        borderRadius: 16,
        background: `linear-gradient(135deg, ${token.colorSuccessBg} 0%, ${token.colorBgContainer} 72%)`,
        border: `1px solid ${token.colorSuccessBorder}`,
      }}
    >
      <div
        className="qa-trophy"
        style={{ background: token.colorSuccessBg, color: token.colorSuccess }}
      >
        <TrophyOutlined />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('全部通过')}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t('{passed}/{total} 个用例通过 · 耗时 {duration}', {
            passed: batch.passed,
            total: batch.total,
            duration: fmtDuration(batch.duration_ms),
          })}
        </Typography.Text>
        <div style={{ marginTop: 6 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('全绿批次不调用 AI 评估；出现失败时才会生成逐条诊断。')}
          </Typography.Text>
        </div>
      </div>
      <Progress
        type="circle"
        percent={100}
        size={86}
        strokeColor={token.colorSuccess}
        format={() => (
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {batch.passed}/{batch.total}
          </span>
        )}
      />
    </div>
  );
}