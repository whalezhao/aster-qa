import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  PrinterOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  getBatch,
  getBatchReportStructured,
  getBatchSignoff,
  revokeBatchReportSignoff,
  signBatchReport,
  type BatchDetail,
  type BatchSignoffInfo,
} from '../api/batches';
import {
  getRunReportStructured,
  type ReportCase,
  type ReportProject,
  type ReportStructured,
} from '../api/runs';
import { apiError } from '../api/client';
import {
  batchStatusLabel,
  fmtDateTime,
  fmtDuration,
  fmtPercent,
  taskTypeLabel,
} from '../lib/format';
import { t } from '../i18n';

/**
 * 测试执行报告（合规留存版）。
 *
 * 和 /runs/:id 的交互式报告的分工：
 * - 交互式报告给测试同学排查问题，有关键帧回放、原始数据；
 * - 这个页面给「归档/盖章」用：固定版式、执行范围、结果汇总、失败详情、电子签章，
 *   打印出来就是一份可留存的 PDF。
 *
 * 签章是**执行记录粒度**的：一次签章只作用于当前这条执行记录，同一任务的其他
 * 执行记录必须单独签；签的是报告文件指纹，报告重新生成后旧章自动失效。
 */
export default function BatchReport() {
  const { bid = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [signOpen, setSignOpen] = useState(false);
  const [note, setNote] = useState('');

  const batchQuery = useQuery({
    queryKey: ['batch', bid],
    queryFn: () => getBatch(bid),
  });
  const reportQuery = useQuery({
    queryKey: ['batch-report', bid],
    queryFn: () => getBatchReportStructured(bid),
    retry: false,
  });
  const fallbackRunId = reportQuery.data?.fallback_run_id ?? null;
  const fallbackQuery = useQuery({
    queryKey: ['run-report', fallbackRunId],
    queryFn: () => getRunReportStructured(fallbackRunId as string),
    enabled: fallbackRunId !== null,
    retry: false,
  });
  const signoffQuery = useQuery({
    queryKey: ['batch-signoff', bid],
    queryFn: () => getBatchSignoff(bid),
    retry: false,
  });

  const sign = useMutation({
    mutationFn: () => signBatchReport(bid, note.trim() || undefined),
    onSuccess: (state) => {
      queryClient.setQueryData(['batch-signoff', bid], state);
      message.success(t('已签章（仅当前执行记录）'));
      setSignOpen(false);
      setNote('');
    },
    onError: (error) => message.error(apiError(error)),
  });
  const revoke = useMutation({
    mutationFn: () => revokeBatchReportSignoff(bid),
    onSuccess: (state) => {
      queryClient.setQueryData(['batch-signoff', bid], state);
      message.success(t('签章已撤销'));
    },
    onError: (error) => message.error(apiError(error)),
  });

  if (
    batchQuery.isLoading ||
    reportQuery.isLoading ||
    fallbackQuery.isLoading ||
    signoffQuery.isLoading
  ) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (batchQuery.isError || !batchQuery.data) {
    return (
      <div style={{ padding: 40 }}>
        <Alert type="error" showIcon message={t('执行记录不存在或无权访问')} />
      </div>
    );
  }

  const batch = batchQuery.data;
  const report = reportQuery.data?.available
    ? reportQuery.data.data
    : fallbackQuery.data?.available
      ? fallbackQuery.data.data
      : null;
  const signoff = signoffQuery.data;
  const teamName = batch.team_name || t('测试团队');
  const running = batch.status === 'running';

  return (
    <div className="qa-formal-layout">
      <div className="qa-formal-toolbar no-print">
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/executions/${bid}`)}>
            {t('返回')}
          </Button>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!report}>
            {t('打印 / 导出 PDF')}
          </Button>
          {signoff?.can_sign && signoff.report_available && report && (
            <>
              {signoff.signed && !signoff.stale ? (
                <Popconfirm
                  title={t('撤销这份报告的签章？')}
                  description={t('撤销会留痕，报告本身不会被删除。')}
                  okText={t('撤销签章')}
                  cancelText={t('取消')}
                  onConfirm={() => revoke.mutate()}
                >
                  <Button danger loading={revoke.isPending}>
                    {t('撤销签章')}
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  type="primary"
                  icon={<SafetyCertificateOutlined />}
                  onClick={() => setSignOpen(true)}
                >
                  {signoff.stale ? t('重新签章') : t('签章')}
                </Button>
              )}
            </>
          )}
        </Space>
      </div>

      {running && (
        <Alert
          className="no-print"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('执行尚未结束')}
          description={t('报告会在本次执行全部结束后生成，届时才能签章。')}
        />
      )}

      {!report ? (
        <div style={{ padding: 40 }}>
          <Empty description={t('这份执行还没有可用的聚合报告')} />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Link to={`/executions/${batch.id}`}>{t('返回执行详情')}</Link>
          </div>
        </div>
      ) : (
        <article className="qa-formal-doc">
          <header className="qa-formal-cover">
            <div className="qa-formal-org">{teamName}</div>
            <h1>{t('测试执行报告')}</h1>
            <div className="qa-formal-en">TEST EXECUTION REPORT</div>
            <div className="qa-formal-no">{t('报告编号：')}{reportNo(batch)}</div>
            <table className="qa-formal-meta">
              <tbody>
                <tr>
                  <th>{t('测试任务')}</th>
                  <td>{batch.task_name || batch.name}</td>
                  <th>{t('任务类型')}</th>
                  <td>{taskTypeLabel(batch.task_type ?? '') || '—'}</td>
                </tr>
                <tr>
                  <th>{t('触发方式')}</th>
                  <td>
                    {
                      {
                        manual: t('手动执行'),
                        regression: t('回归执行'),
                        rerun: t('失败重跑'),
                        schedule: t('定时执行'),
                        ci: t('CI 触发'),
                      }[batch.trigger] ?? batch.trigger
                    }
                  </td>
                  <th>{t('执行状态')}</th>
                  <td>{batchStatusLabel(batch.status)}</td>
                </tr>
                <tr>
                  <th>{t('执行环境')}</th>
                  <td>{batch.environment_name || t('默认')}</td>
                  <th>{t('质量门禁')}</th>
                  <td>
                    {batch.gate_detail && batch.gate_detail.status !== 'disabled'
                      ? batch.gate_detail.status === 'passed'
                        ? t('通过')
                        : batch.gate_detail.status === 'failed'
                          ? t('未通过：{reasons}', { reasons: batch.gate_detail.reasons.join(t('；')) })
                          : batch.gate_detail.status === 'no_data'
                            ? t('无有效执行：{reasons}', { reasons: batch.gate_detail.reasons.join(t('；')) })
                            : t('待执行完成')
                      : t('未启用')}
                  </td>
                </tr>
                <tr>
                  <th>{t('执行人')}</th>
                  <td>{batch.created_by_name || '—'}</td>
                  <th>{t('执行时间')}</th>
                  <td>
                    {fmtDateTime(batch.started_at ?? batch.created_at)}
                    {batch.ended_at ? t(' 至 {time}', { time: fmtDateTime(batch.ended_at) }) : ''}
                  </td>
                </tr>
                <tr>
                  <th>{t('涉及项目')}</th>
                  <td>{t('{n} 个', { n: batch.project_count })}</td>
                  <th>{t('执行耗时')}</th>
                  <td>{fmtDuration(batch.duration_ms)}</td>
                </tr>
                <tr>
                  <th>{t('执行 ID')}</th>
                  <td colSpan={3}>
                    <Typography.Text code style={{ fontSize: 12 }}>
                      {batch.id}
                    </Typography.Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </header>

          <section className="qa-formal-section">
            <h2>{t('一、执行概况')}</h2>
            <div className="qa-formal-kpis">
              <Kpi label={t('用例总数')} value={String(report.stats.cases)} />
              <Kpi label={t('通过')} value={String(report.stats.passed)} tone="pass" />
              <Kpi label={t('失败')} value={String(report.stats.failed)} tone={report.stats.failed ? 'fail' : undefined} />
              <Kpi
                label={t('通过率')}
                value={fmtPercent(report.stats.cases ? report.stats.passed / report.stats.cases : null)}
              />
              <Kpi label={t('步骤数')} value={String(report.stats.steps)} />
              <Kpi label={t('耗时')} value={fmtDuration(report.stats.durationMs)} />
            </div>
            <p className="qa-formal-note">
              {t('本次执行覆盖 {projects} 个项目、{cases} 个用例，共 {steps} 个执行步骤；使用模型 {models}。详细执行证据（关键帧、参数、日志）可在平台按执行 ID 追溯。', {
                projects: batch.project_count,
                cases: report.stats.cases,
                steps: report.stats.steps,
                models: report.stats.models.map((model) => model.model).join(t('、')) || '—',
              })}
            </p>
          </section>

          <section className="qa-formal-section">
            <h2>{t('二、测试范围与功能结果')}</h2>
            {batch.features.length === 0 ? (
              <p className="qa-formal-note">{t('本次执行没有功能维度的结果。')}</p>
            ) : (
              <table className="qa-formal-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('功能')}</th>
                    <th>{t('分期')}</th>
                    <th>{t('通过 / 总数')}</th>
                    <th>{t('结果')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.features.map((feature, index) => (
                    <tr key={feature.feature_id}>
                      <td>{index + 1}</td>
                      <td>{feature.name}</td>
                      <td>{feature.stage === 'released' ? t('正式') : t('当前迭代')}</td>
                      <td>
                        {feature.passed}/{feature.total}
                      </td>
                      <td>
                        <span className={`qa-formal-status ${feature.failed ? 'is-fail' : 'is-pass'}`}>
                          {feature.failed ? t('失败 {n}', { n: feature.failed }) : t('通过')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="qa-formal-section">
            <h2>{t('三、用例执行明细')}</h2>
            <CaseTable report={report} />
          </section>

          {failedCases(report).length > 0 && (
            <section className="qa-formal-section">
              <h2>{t('四、失败详情')}</h2>
              <div className="qa-formal-failures">
                {failedCases(report).map(({ project, item }) => (
                  <div className="qa-formal-failure" key={`${project.id}:${item.id}`}>
                    <div className="qa-formal-failure-head">
                      <span className="qa-formal-status is-fail">{t('失败')}</span>
                      <strong>{item.name}</strong>
                      <span className="qa-formal-failure-project">{project.projectName || project.name}</span>
                    </div>
                    {item.steps
                      .filter((step) => step.status === 'failed')
                      .map((step, index) => (
                        <div className="qa-formal-failure-step" key={`${item.id}-${index}`}>
                          <div className="qa-formal-failure-title">
                            {step.title}
                            {step.error ? '' : t('（未提供具体错误信息）')}
                          </div>
                          {step.error && <pre className="qa-formal-error">{step.error}</pre>}
                        </div>
                      ))}
                    {item.steps.every((step) => step.status !== 'failed') && (
                      <div className="qa-formal-note">{t('用例失败，具体步骤信息见平台执行记录。')}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="qa-formal-section qa-formal-sign">
            <h2>{failedCases(report).length > 0 ? t('五、报告签章') : t('四、报告签章')}</h2>
            {signoff?.signed && !signoff.stale && signoff.signoff ? (
              <Seal teamName={teamName} signoff={signoff.signoff} />
            ) : signoff?.stale ? (
              <Alert
                type="warning"
                showIcon
                message={t('原签章已失效')}
                description={t('报告内容在签章后发生了变化（或报告文件被重新生成），请重新签章。')}
              />
            ) : (
              <div className="qa-formal-unsigned">
                <div className="qa-formal-unsigned-title">{t('本执行记录尚未签章')}</div>
                <div className="qa-formal-note">
                  {!signoff?.report_available
                    ? t('聚合报告尚未生成（老批次没有聚合产物），暂不能签章。')
                    : signoff.can_sign
                      ? t('签章只作用于当前执行记录；请在执行记录列表或本页选择要签章的执行记录。')
                      : t('如需归档留存，请联系团队管理员完成签章。')}
                </div>
              </div>
            )}

            <div className="qa-formal-sign-lines">
              <span>{t('执行人（签字）：')}{batch.created_by_name || '________________'}</span>
              <span>
                {t('审核人（签章）：')}
                {signoff?.signed && !signoff.stale && signoff.signoff?.signed_by_name
                  ? signoff.signoff.signed_by_name
                  : '________________'}
              </span>
              <span>
                {t('日期：')}
                {signoff?.signed && !signoff.stale && signoff.signoff
                  ? fmtDateTime(signoff.signoff.signed_at)
                  : '________________'}
              </span>
            </div>
            <div className="qa-formal-fingerprint">
              {t('报告指纹：')}{signoff?.report_hash ?? '—'}
              <span className="qa-formal-fingerprint-note">
                {t('（仅当前执行记录；内容变更后指纹失效，可用于核验留存版本）')}
              </span>
            </div>
          </section>

          <footer className="qa-formal-footer">
            {t('本报告由 Aster QA 根据实际执行产物自动生成 · 报告生成时间 {time} · 执行 ID {id}', {
              time: fmtDateTime(report.generatedAt),
              id: batch.id,
            })}
          </footer>
        </article>
      )}

      <Modal
        title={t('签章 · 仅当前执行记录')}
        open={signOpen}
        onCancel={() => setSignOpen(false)}
        onOk={() => sign.mutate()}
        confirmLoading={sign.isPending}
        okText={t('确认签章')}
        cancelText={t('取消')}
      >
        <Typography.Paragraph type="secondary">
          {t('本次签章只作用于执行记录「{name}」，同一测试任务的其他执行记录需要分别签章。签章绑定当前报告内容的指纹，报告重新生成后原签章会自动失效。', { name: batch.name })}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={500}
          showCount
          placeholder={t('签章备注（可选），例如：本次回归结论已审核')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Modal>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pass' | 'fail' }) {
  return (
    <div className={`qa-formal-kpi${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function reportNo(batch: BatchDetail): string {
  const date = (batch.created_at || '').slice(0, 10).replace(/-/g, '');
  return `AR-${date}-${batch.id.slice(0, 8).toUpperCase()}`;
}

function allCases(report: ReportStructured): Array<{ project: ReportProject; item: ReportCase }> {
  return report.projects.flatMap((project) =>
    project.cases.map((item) => ({ project, item })),
  );
}

function failedCases(report: ReportStructured): Array<{ project: ReportProject; item: ReportCase }> {
  return allCases(report).filter(({ item }) => item.status === 'failed');
}

function CaseTable({ report }: { report: ReportStructured }) {
  const rows = allCases(report);
  if (rows.length === 0) {
    return <p className="qa-formal-note">{t('报告里没有用例结果。')}</p>;
  }
  return (
    <table className="qa-formal-table">
      <thead>
        <tr>
          <th>#</th>
          <th>{t('项目')}</th>
          <th>{t('用例')}</th>
          <th>{t('步骤')}</th>
          <th>{t('耗时')}</th>
          <th>{t('结果')}</th>
          <th>{t('失败信息')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ project, item }, index) => {
          const failedStep = item.steps.find((step) => step.status === 'failed');
          return (
            <tr key={`${project.id}:${item.id}`}>
              <td>{index + 1}</td>
              <td>{project.projectName || project.name}</td>
              <td>{item.name}</td>
              <td>{item.steps.length}</td>
              <td>{fmtDuration(item.durationMs)}</td>
              <td>
                <span className={`qa-formal-status ${item.status === 'passed' ? 'is-pass' : item.status === 'failed' ? 'is-fail' : ''}`}>
                  {item.status === 'passed' ? t('通过') : item.status === 'failed' ? t('失败') : t('未执行')}
                </span>
              </td>
              <td className="qa-formal-failure-cell">
                {failedStep ? failedStep.error || failedStep.summary || failedStep.title : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Seal({ teamName, signoff }: { teamName: string; signoff: BatchSignoffInfo }) {
  const signedAt = new Date(signoff.signed_at);
  return (
    <div className="qa-formal-seal-row">
      <div className="qa-seal" aria-label={t('电子签章')}>
        <span className="qa-seal-team">{teamName}</span>
        <span className="qa-seal-star">★</span>
        <span className="qa-seal-title">{t('测试报告专用章')}</span>
        <span className="qa-seal-date">
          {signedAt.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </span>
      </div>
      <div className="qa-formal-seal-info">
        <div className="qa-formal-seal-name">
          {signoff.signed_by_name || '—'} <span>{t('（电子签章）')}</span>
        </div>
        <div>{t('签章时间：')}{fmtDateTime(signoff.signed_at)}</div>
        <div>
          {t('签章时结果：')}{signoff.passed}/{signoff.case_count} {t('通过')}
          {signoff.failed ? t('，{n} 个失败', { n: signoff.failed }) : ''}
        </div>
        {signoff.note && <div>{t('备注：')}{signoff.note}</div>}
        <div className="qa-formal-seal-hint">{t('仅对当前执行记录生效，由 Aster QA 生成并与报告指纹绑定')}</div>
      </div>
    </div>
  );
}
