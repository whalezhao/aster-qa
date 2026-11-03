import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Col, Empty, Form, Input, Row, Select, Space, Spin, Tabs, Tag, Tooltip, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { getCase, getCaseHistory, updateCase, validateYaml, type CaseInput } from '../api/cases';
import ModelConfigNotice from '../components/ModelConfigNotice';
import { apiError } from '../api/client';
import { failureKindLabel, fmtDateTime, fmtDuration } from '../lib/format';
import { PAGE, byDate, byNumber, byRank, byText } from '../lib/table';
import type { CaseHistoryItem, FeatureStage, Priority, ValidateResult } from '../api/types';
import QaTable from '../components/QaTable';
import CaseVersionsTab from '../components/CaseVersionsTab';
import EnvVariableHint from '../components/EnvVariableHint';
import { t } from '../i18n';

interface CaseFormValues {
  name: string;
  yaml_content: string;
  description?: string;
  priority?: Priority | null;
  defect_ids?: string;
  stage_override?: FeatureStage | null;
}

export default function CaseEditor() {
  const { cid = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CaseFormValues>();
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(false);

  const { data: testCase, isLoading } = useQuery({ queryKey: ['case', cid], queryFn: () => getCase(cid) });

  useEffect(() => {
    if (testCase) {
      form.setFieldsValue({
        name: testCase.name,
        yaml_content: testCase.yaml_content,
        description: testCase.description ?? undefined,
        priority: testCase.priority,
        defect_ids: testCase.defect_ids ?? undefined,
        stage_override: testCase.stage_override,
      });
    }
  }, [testCase, form]);

  const yaml = Form.useWatch('yaml_content', form);

  // YAML 校验：防抖 500ms
  useEffect(() => {
    if (yaml === undefined) return;
    setValidating(true);
    const timer = setTimeout(async () => {
      try {
        setValidation(await validateYaml(yaml ?? ''));
      } catch (e) {
        setValidation({ ok: false, errors: [apiError(e)], case_count: 0 });
      } finally {
        setValidating(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [yaml]);

  const saveMutation = useMutation({
    mutationFn: (v: CaseFormValues) =>
      updateCase(cid, {
        ...v,
        priority: v.priority ?? null,
        // 清空输入框存 NULL，别在库里留空串
        defect_ids: v.defect_ids?.trim() || null,
        stage_override: v.stage_override ?? null,
        change_source: 'manual',
      } as CaseInput),
    onSuccess: () => {
      message.success(t('用例已保存'));
      queryClient.invalidateQueries({ queryKey: ['case', cid] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['case-versions', cid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      {/* 放在 Card 外面：Card 的 loading 态会卸载子节点，放里面提示会闪 */}
      <ModelConfigNotice projectId={testCase?.project_id} action={t('执行用例')} />
      <EnvVariableHint projectId={testCase?.project_id} style={{ marginBottom: 12 }} />
      <ProCard
        title={testCase ? t('用例：{name}', { name: testCase.name }) : t('用例')}
        extra={
          <Space>
            {/* 直接手改 YAML 之外，也可以让 AI 按对话要求改 */}
            <Button
              type="primary"
              icon={<RobotOutlined />}
              disabled={!testCase}
              onClick={() => navigate(`/cases/${cid}/ai`)}
            >
              {t('用 AI 修改')}
            </Button>
            <Link to={`/features/${testCase?.feature_id ?? ''}`}>{t('返回功能')}</Link>
          </Space>
        }
        loading={isLoading}
      >
      <Tabs
        items={[
          {
            key: 'edit',
            label: t('编辑'),
            children: (
              <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
                <Row gutter={16}>
                  <Col xs={24} lg={14}>
                    <Form.Item name="name" label={t('名称')} rules={[{ required: true, message: t('请输入用例名称') }]}>
                      <Input />
                    </Form.Item>
                    <Space style={{ display: 'flex' }} align="start">
                      <Form.Item name="priority" label={t('优先级')} style={{ width: 160 }}>
                        <Select
                          allowClear
                          placeholder={t('可不选')}
                          options={(['P0', 'P1', 'P2', 'P3'] as Priority[]).map((p) => ({ value: p, label: p }))}
                        />
                      </Form.Item>
                      <Form.Item name="stage_override" label={t('分期覆盖')} style={{ width: 200 }}>
                        <Select
                          allowClear
                          placeholder={t('跟随功能')}
                          options={[
                            { value: 'in_iteration', label: t('当前迭代') },
                            { value: 'released', label: t('正式') },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name="defect_ids"
                        label={t('缺陷编号')}
                        style={{ width: 240 }}
                        tooltip={t('这条用例是为哪个缺陷补的（禅道/Jira 的 bug 单号）。多个用逗号分隔')}
                      >
                        <Input placeholder={t('可留空')} allowClear />
                      </Form.Item>
                      <Form.Item label={t('当前生效分期')}>
                        <Tag color={testCase?.effective_stage === 'released' ? 'success' : 'processing'}>
                          {testCase?.effective_stage === 'released' ? t('正式') : t('当前迭代')}
                        </Tag>
                      </Form.Item>
                    </Space>
                    <Form.Item name="description" label={t('描述')}>
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item
                      name="yaml_content"
                      label={t('YAML 内容')}
                      rules={[{ required: true, message: t('请输入 YAML 内容') }]}
                    >
                      <Input.TextArea rows={18} style={{ fontFamily: 'monospace' }} spellCheck={false} />
                    </Form.Item>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      htmlType="submit"
                      loading={saveMutation.isPending}
                    >
                      {t('保存')}
                    </Button>
                  </Col>

                  <Col xs={24} lg={10}>
                    <ProCard
                      size="small"
                      title={t('校验结果')}
                      extra={validating ? <Spin size="small" /> : null}
                    >
                      <ValidationPanel result={validation} />
                    </ProCard>
                  </Col>
                </Row>
              </Form>
            ),
          },
          {
            key: 'history',
            label: t('历史执行结果'),
            children: <HistoryTab cid={cid} />,
          },
          {
            key: 'versions',
            label: t('版本历史'),
            children: <CaseVersionsTab caseId={cid} />,
          },
        ]}
      />
      </ProCard>
    </div>
  );
}

function ValidationPanel({ result }: { result: ValidateResult | null }) {
  if (!result) {
    return <Empty description={t('输入 YAML 后自动校验')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  if (result.ok) {
    return (
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        message={t('校验通过')}
        description={t('解析出 {n} 个用例', { n: result.case_count })}
      />
    );
  }
  return (
    <Alert
      type="error"
      showIcon
      icon={<CloseCircleOutlined />}
      message={t('校验未通过')}
      description={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {result.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      }
    />
  );
}

function HistoryTab({ cid }: { cid: string }) {
  const navigate = useNavigate();
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['case-history', cid],
    queryFn: () => getCaseHistory(cid),
  });

  return (
    <QaTable<CaseHistoryItem>
      rowKey="run_id"
      loading={isLoading}
      dataSource={history}
      pagination={PAGE}
      locale={{ emptyText: t('暂无执行记录') }}
      columns={[
        {
          title: t('执行时间'),
          width: 170,
          dataIndex: 'started_at',
          sorter: byDate<CaseHistoryItem>((r) => r.started_at),
          render: (v: string | null) => fmtDateTime(v),
        },
        {
          // 光看结果不知道是哪次、跑的是哪儿，没法判断这次是不是自己关心的
          title: t('执行来源'),
          sorter: byText<CaseHistoryItem>((r) => r.batch_name),
          render: (_, r) => (
            <Space direction="vertical" size={0}>
              {r.batch_id ? (
                <Link to={`/executions/${r.batch_id}`}>{r.batch_name ?? t('查看执行')}</Link>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {[r.team_name, r.project_name, r.iteration_name].filter(Boolean).join(' / ') || '-'}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: t('结果'),
          dataIndex: 'status',
          width: 110,
          sorter: byRank<CaseHistoryItem>((r) => r.status, ['success', 'failed']),
          render: (s: string, r) => {
            // midscene 返回的是 success / failed / notRun
            if (s === 'success') return <Tag color="success">{t('通过')}</Tag>;
            if (s === 'failed') {
              const kind = failureKindLabel(r.failure_kind);
              // 非用例原因的失败要标出来，否则会被当成真实缺陷去追
              return kind ? <Tag>{t('未计入 · {kind}', { kind })}</Tag> : <Tag color="error">{t('失败')}</Tag>;
            }
            return <Tag>{s}</Tag>;
          },
        },
        {
          title: t('尝试'),
          dataIndex: 'attempt_count',
          width: 100,
          sorter: byNumber<CaseHistoryItem>((r) => r.attempt_count),
          render: (v: number, r) => (
            <Tooltip title={r.passed_after_retry ? t('重试后才通过 —— 这个用例不太稳') : undefined}>
              <span>{t('{n} 次', { n: v })}{r.passed_after_retry ? t('（重试后通过）') : ''}</span>
            </Tooltip>
          ),
        },
        {
          title: t('模型'),
          dataIndex: 'model_name',
          width: 150,
          sorter: byText<CaseHistoryItem>((r) => r.model_name),
          render: (v: string | null) => v || '-',
        },
        {
          title: t('耗时'),
          dataIndex: 'duration_ms',
          width: 90,
          sorter: byNumber<CaseHistoryItem>((r) => r.duration_ms),
          render: (v: number | null) => fmtDuration(v),
        },
        {
          title: t('报告'),
          width: 90,
          render: (_, r) =>
            r.report_available ? (
              <Button size="small" type="link" onClick={() => navigate(`/runs/${r.run_id}?tab=report`)}>
                {t('查看')}
              </Button>
            ) : (
              <Typography.Text type="secondary">-</Typography.Text>
            ),
        },
      ]}
    />
  );
}
