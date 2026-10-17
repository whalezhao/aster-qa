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
      } as CaseInput),
    onSuccess: () => {
      message.success('用例已保存');
      queryClient.invalidateQueries({ queryKey: ['case', cid] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
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
      <ModelConfigNotice projectId={testCase?.project_id} action="执行用例" />
      <ProCard
        title={testCase ? `用例：${testCase.name}` : '用例'}
        extra={
          <Space>
            {/* 直接手改 YAML 之外，也可以让 AI 按对话要求改 */}
            <Button
              type="primary"
              icon={<RobotOutlined />}
              disabled={!testCase}
              onClick={() => navigate(`/cases/${cid}/ai`)}
            >
              用 AI 修改
            </Button>
            <Link to={`/features/${testCase?.feature_id ?? ''}`}>返回功能</Link>
          </Space>
        }
        loading={isLoading}
      >
      <Tabs
        items={[
          {
            key: 'edit',
            label: '编辑',
            children: (
              <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
                <Row gutter={16}>
                  <Col xs={24} lg={14}>
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入用例名称' }]}>
                      <Input />
                    </Form.Item>
                    <Space style={{ display: 'flex' }} align="start">
                      <Form.Item name="priority" label="优先级" style={{ width: 160 }}>
                        <Select
                          allowClear
                          placeholder="可不选"
                          options={(['P0', 'P1', 'P2', 'P3'] as Priority[]).map((p) => ({ value: p, label: p }))}
                        />
                      </Form.Item>
                      <Form.Item name="stage_override" label="分期覆盖" style={{ width: 200 }}>
                        <Select
                          allowClear
                          placeholder="跟随功能"
                          options={[
                            { value: 'in_iteration', label: '当前迭代' },
                            { value: 'released', label: '正式' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name="defect_ids"
                        label="缺陷编号"
                        style={{ width: 240 }}
                        tooltip="这条用例是为哪个缺陷补的（禅道/Jira 的 bug 单号）。多个用逗号分隔"
                      >
                        <Input placeholder="可留空" allowClear />
                      </Form.Item>
                      <Form.Item label="当前生效分期">
                        <Tag color={testCase?.effective_stage === 'released' ? 'success' : 'processing'}>
                          {testCase?.effective_stage === 'released' ? '正式' : '当前迭代'}
                        </Tag>
                      </Form.Item>
                    </Space>
                    <Form.Item name="description" label="描述">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item
                      name="yaml_content"
                      label="YAML 内容"
                      rules={[{ required: true, message: '请输入 YAML 内容' }]}
                    >
                      <Input.TextArea rows={18} style={{ fontFamily: 'monospace' }} spellCheck={false} />
                    </Form.Item>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      htmlType="submit"
                      loading={saveMutation.isPending}
                    >
                      保存
                    </Button>
                  </Col>

                  <Col xs={24} lg={10}>
                    <ProCard
                      size="small"
                      title="校验结果"
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
            label: '历史执行结果',
            children: <HistoryTab cid={cid} />,
          },
        ]}
      />
      </ProCard>
    </div>
  );
}

function ValidationPanel({ result }: { result: ValidateResult | null }) {
  if (!result) {
    return <Empty description="输入 YAML 后自动校验" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  if (result.ok) {
    return (
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        message="校验通过"
        description={`解析出 ${result.case_count} 个用例`}
      />
    );
  }
  return (
    <Alert
      type="error"
      showIcon
      icon={<CloseCircleOutlined />}
      message="校验未通过"
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
      locale={{ emptyText: '暂无执行记录' }}
      columns={[
        {
          title: '执行时间',
          width: 170,
          dataIndex: 'started_at',
          sorter: byDate<CaseHistoryItem>((r) => r.started_at),
          render: (v: string | null) => fmtDateTime(v),
        },
        {
          // 光看结果不知道是哪次、跑的是哪儿，没法判断这次是不是自己关心的
          title: '执行来源',
          sorter: byText<CaseHistoryItem>((r) => r.batch_name),
          render: (_, r) => (
            <Space direction="vertical" size={0}>
              {r.batch_id ? (
                <Link to={`/executions/${r.batch_id}`}>{r.batch_name ?? '查看执行'}</Link>
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
          title: '结果',
          dataIndex: 'status',
          width: 110,
          sorter: byRank<CaseHistoryItem>((r) => r.status, ['success', 'failed']),
          render: (s: string, r) => {
            // midscene 返回的是 success / failed / notRun
            if (s === 'success') return <Tag color="success">通过</Tag>;
            if (s === 'failed') {
              const kind = failureKindLabel(r.failure_kind);
              // 非用例原因的失败要标出来，否则会被当成真实缺陷去追
              return kind ? <Tag>未计入 · {kind}</Tag> : <Tag color="error">失败</Tag>;
            }
            return <Tag>{s}</Tag>;
          },
        },
        {
          title: '尝试',
          dataIndex: 'attempt_count',
          width: 100,
          sorter: byNumber<CaseHistoryItem>((r) => r.attempt_count),
          render: (v: number, r) => (
            <Tooltip title={r.passed_after_retry ? '重试后才通过 —— 这个用例不太稳' : undefined}>
              <span>{v} 次{r.passed_after_retry ? '（重试后通过）' : ''}</span>
            </Tooltip>
          ),
        },
        {
          title: '模型',
          dataIndex: 'model_name',
          width: 150,
          sorter: byText<CaseHistoryItem>((r) => r.model_name),
          render: (v: string | null) => v || '-',
        },
        {
          title: '耗时',
          dataIndex: 'duration_ms',
          width: 90,
          sorter: byNumber<CaseHistoryItem>((r) => r.duration_ms),
          render: (v: number | null) => fmtDuration(v),
        },
        {
          title: '报告',
          width: 90,
          render: (_, r) =>
            r.report_available ? (
              <Button size="small" type="link" onClick={() => navigate(`/runs/${r.run_id}?tab=report`)}>
                查看
              </Button>
            ) : (
              <Typography.Text type="secondary">-</Typography.Text>
            ),
        },
      ]}
    />
  );
}
