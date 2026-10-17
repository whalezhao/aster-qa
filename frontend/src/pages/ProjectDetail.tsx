import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, AutoComplete, Button, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Switch, Tag, Typography } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { PlusOutlined } from '@ant-design/icons';
import {
  bulkReleaseFeatures,
  createFeature,
  deleteFeature,
  getCaseCounts,
  getFeatures,
  releaseFeature,
  reopenFeature,
  updateFeature,
  type FeatureInput,
} from '../api/features';
import { clearModelConfig, getModelConfig, getProject, setModelConfig, testModelConfig } from '../api/projects';
import { getIterationsByTeam } from '../api/iterations';
import { apiError } from '../api/client';
import { PAGE, byNumber, byRank, byText } from '../lib/table';
import { fmtTokens } from '../lib/format';
import type { BulkReleaseResult, Feature, FeatureStage } from '../api/types';
import QaTable from '../components/QaTable';
import EnvironmentsCard from '../components/EnvironmentsCard';

type StageFilter = 'all' | FeatureStage;

interface FeatureFormValues {
  name: string;
  description?: string;
  requirement_ids?: string;
  iteration_id?: string | null;
}

/**
 * 项目级模型配置。
 *
 * 语义是「逐字段覆盖全局」：留空的项继续用 runner/.env 里的值。
 * 后端不返回密钥本身，所以密钥框永远是空的 —— 留空表示不改动，要清空得按「清除密钥」。
 */
/**
 * midscene 1.15.4 实际接受的模型族。这份列表是从 @midscene/core 的
 * ai-model/models/ 适配器里逐个 grep 出来的，**不是**从报错信息里抄的 ——
 * 报错信息给的集合和真实可用的并不一致（照它填 openai 会直接失败）。
 */
const MODEL_FAMILY_SUGGESTIONS = [
  { value: 'qwen3-vl' },
  { value: 'qwen2.5-vl' },
  { value: 'qwen3.5' },
  { value: 'qwen3.6' },
  { value: 'doubao-vision' },
  { value: 'doubao-seed' },
  { value: 'glm-v' },
  { value: 'gpt-5' },
  { value: 'gpt-6' },
  { value: 'xiaomi-mimo' },
];

const REASONING_OPTIONS = [
  { value: 'inherit', label: '跟随全局' },
  { value: 'off', label: '关闭思考' },
  { value: 'on', label: '开启思考' },
];

function ModelConfigCard({ projectId }: { projectId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['model-config', projectId],
    queryFn: () => getModelConfig(projectId),
  });

  // 表单由服务端数据驱动。
  // 不能用 initialValues + key 重挂载那套：form 实例是父组件 useForm() 建的，
  // 重挂 Form 元素不会清空它的 store，而 resetFields() 又会重置回「首次挂载时捕获的」
  // 旧 initialValues —— 实测表现就是「恢复全局」之后输入框里还留着旧模型名。
  useEffect(() => {
    // Card 的 loading 态会让 Form 根本没挂载，这时候 setFieldsValue 会报
    // "useForm is not connected to any Form element"
    if (isLoading) return;
    form.setFieldsValue({
      model_name: config?.model_name ?? undefined,
      model_family: config?.model_family ?? undefined,
      base_url: config?.base_url ?? undefined,
      init_config_json: config?.init_config_json ?? undefined,
      api_key: undefined, // 密钥永远不回显
      token_quota: config?.token_quota ?? undefined,
      reasoning:
        config?.reasoning_enabled === true
          ? 'on'
          : config?.reasoning_enabled === false
            ? 'off'
            : 'inherit',
    });
  }, [config, isLoading, form]);

  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const payload: Parameters<typeof setModelConfig>[1] = {};
      for (const k of ['model_name', 'model_family', 'base_url', 'init_config_json'] as const) {
        if (v[k] !== undefined) payload[k] = String(v[k]);
      }
      if (v.api_key) payload.api_key = String(v.api_key);
      // 三态：inherit 要显式告诉后端「恢复跟随全局」，不能靠不传
      if (v.reasoning === 'on') payload.reasoning_enabled = true;
      else if (v.reasoning === 'off') payload.reasoning_enabled = false;
      else payload.clear_reasoning = true;
      // 限额：清空输入框 = 取消限额
      if (v.token_quota === undefined || v.token_quota === null || v.token_quota === '') {
        payload.clear_token_quota = true;
      } else {
        payload.token_quota = Number(v.token_quota);
      }
      return setModelConfig(projectId, payload);
    },
    onSuccess: () => {
      setTestResult(null);
      message.success('已保存，该项目下次执行起生效');
      queryClient.invalidateQueries({ queryKey: ['model-config', projectId] });
      // 项目列表上的「已配置/未配置」标记、以及各处提示都依赖它，一并刷新
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const test = useMutation({
    mutationFn: () => {
      const v = form.getFieldsValue(['model_name', 'base_url', 'api_key']) as Record<
        string,
        string | undefined
      >;
      return testModelConfig(projectId, {
        model_name: v.model_name?.trim() || undefined,
        base_url: v.base_url?.trim() || undefined,
        api_key: v.api_key?.trim() || undefined,
      });
    },
    onSuccess: (r) => setTestResult({ ok: r.ok, message: r.message }),
    onError: (e) => setTestResult({ ok: false, message: apiError(e) }),
  });

  const clearKey = useMutation({
    mutationFn: () => setModelConfig(projectId, { clear_api_key: true }),
    onSuccess: () => {
      message.success('已清除该项目的 API Key');
      queryClient.invalidateQueries({ queryKey: ['model-config', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const reset = useMutation({
    mutationFn: () => clearModelConfig(projectId),
    onSuccess: () => {
      message.success('已清空模型配置，该项目下用例将无法执行');
      // 不用 resetFields()：那会重置回陈旧值，交给上面那个 useEffect 从新数据驱动
      queryClient.invalidateQueries({ queryKey: ['model-config', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <ProCard
      style={{ marginTop: 16 }}
      loading={isLoading}
      title={
        <Space>
          <span>大模型配置</span>
          {config?.configured ? (
            <Tag color="success">已配置</Tag>
          ) : (
            <Tag color="warning">未配置 · 该项目无法执行</Tag>
          )}
          {config?.model_health && (
            <Tag
              color={
                config.model_health.status === 'healthy'
                  ? 'green'
                  : config.model_health.status === 'unhealthy'
                    ? 'red'
                    : 'default'
              }
            >
              模型{config.model_health.status === 'healthy' ? '正常' : config.model_health.status === 'unhealthy' ? '异常' : '未检测'}
            </Tag>
          )}
        </Space>
      }
      extra={
        config?.configured ? (
          <Popconfirm
            title="清空该项目的模型配置？"
            description="清空后该项目下所有用例都无法执行，直到重新配置。"
            onConfirm={() => reset.mutate()}
          >
            <Button size="small" danger loading={reset.isPending}>
              清空配置
            </Button>
          </Popconfirm>
        ) : null
      }
    >
      {config?.configured ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="配置完整，该项目下的用例可以执行"
          description={`模型族、额外请求配置、思考模式可以留空；模型名为 ${
            config.model_name ?? '-'
          }。`}
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`还差：${(config?.missing ?? []).join('、') || '配置'}`}
          description="平台不提供全局大模型，每个项目必须自己指定。三项补齐后该项目下的用例才能执行。"
        />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => save.mutate(v)}
      >
        <Space style={{ display: 'flex' }} align="start" wrap>
          <Form.Item
            name="model_name"
            label="模型名"
            style={{ width: 260 }}
            rules={[{ required: true, message: '必填' }]}
            tooltip="执行该项目的用例时用这个模型名"
          >
            <Input placeholder="如 qwen-vl-max" allowClear />
          </Form.Item>
          <Form.Item
            name="model_family"
            label="模型族"
            style={{ width: 260 }}
            tooltip="执行器会校验这个取值，填错会直接执行失败。"
          >
            <AutoComplete
              options={MODEL_FAMILY_SUGGESTIONS}
              placeholder="如 qwen2.5-vl"
              allowClear
              filterOption={(input, option) =>
                String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="接入地址"
            style={{ width: 340 }}
            rules={[{ required: true, message: '必填' }]}
            tooltip="兼容 OpenAI 协议的服务地址（一般形如 …/v1）"
          >
            <Input placeholder="如 https://api.example.com/v1" allowClear />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            style={{ width: 300 }}
            tooltip="存进数据库。接口不会回显密钥，只告诉你配没配。"
            rules={[
              {
                // 已经存过密钥时输入框是空的（不回显），这时候不算缺失
                validator: (_, v) =>
                  config?.api_key_set || (typeof v === 'string' && v.trim())
                    ? Promise.resolve()
                    : Promise.reject(new Error('必填')),
              },
            ]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={
                config?.api_key_set ? '已配置（留空则不修改）' : '必填'
              }
            />
          </Form.Item>
          <Form.Item
            name="reasoning"
            label="模型思考模式"
            style={{ width: 180 }}
            tooltip="推理模型（Qwen3.x 这类）默认会把 token 大量花在思考上，一次小请求就可能烧光 max_tokens 并返回空内容，执行器直接解析不到结果。跑不通时先关掉它。"
          >
            <Select options={REASONING_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="token_quota"
            label="每月 token 限额"
            style={{ width: 200 }}
            tooltip="执行器消耗 + 平台 AI 调用（生成用例/评估/复盘）合计。留空 = 不限；超出后不再发起新执行和 AI 调用。"
          >
            <InputNumber
              min={0}
              step={100000}
              style={{ width: '100%' }}
              placeholder="不限"
            />
          </Form.Item>
        </Space>

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          本月已用 {fmtTokens(config?.month_tokens_used ?? 0)} tokens
          {config?.token_quota
            ? `（限额 ${fmtTokens(config.token_quota)}）`
            : '（未设限额）'}
          ，按自然月统计，下月 1 日归零。
        </Typography.Text>

        <Form.Item
          name="init_config_json"
          label="额外请求配置（JSON，可选）"
          tooltip="用于自定义请求头、额外请求参数等。"
        >
          <Input.TextArea rows={2} placeholder='如 {"defaultHeaders":{"x-foo":"bar"}}' />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存
          </Button>
          <Button
            onClick={() => test.mutate()}
            loading={test.isPending}
            title="用当前表单里的值实际请求一次模型"
          >
            测试连接
          </Button>
          {config?.api_key_set && (
            <Popconfirm
              title="清除该项目的 API Key？"
              description="清除后配置就不完整了，该项目下的用例将无法执行，直到重新填入。"
              onConfirm={() => clearKey.mutate()}
            >
              <Button danger loading={clearKey.isPending}>
                清除密钥
              </Button>
            </Popconfirm>
          )}
        </Space>

        {testResult && (
          <Alert
            style={{ marginTop: 16 }}
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            closable
            onClose={() => setTestResult(null)}
            message={testResult.ok ? '连接成功' : '连接失败'}
            description={testResult.message}
          />
        )}
      </Form>
    </ProCard>
  );
}

export default function ProjectDetail() {
  const { pid = '' } = useParams();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<StageFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Feature | null>(null);
  const [form] = Form.useForm<FeatureFormValues>();
  const [releaseIds, setReleaseIds] = useState<string[] | null>(null);
  const [cascade, setCascade] = useState(true);

  const { data: project } = useQuery({ queryKey: ['project', pid], queryFn: () => getProject(pid) });
  const { data: features = [], isLoading } = useQuery({
    queryKey: ['features', pid, stage],
    queryFn: () => getFeatures(pid, stage === 'all' ? undefined : stage),
  });
  const { data: caseCounts = {} } = useQuery({
    queryKey: ['case-counts', pid],
    queryFn: () => getCaseCounts(pid),
  });
  const { data: iterations = [] } = useQuery({
    queryKey: ['iterations', project?.team_id ?? ''],
    queryFn: () => getIterationsByTeam(project!.team_id),
    enabled: !!project,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['features', pid] });
    queryClient.invalidateQueries({ queryKey: ['case-counts', pid] });
  };

  const saveMutation = useMutation({
    mutationFn: (v: FeatureFormValues) => {
      // 清空输入框要存成 NULL 而不是空串，否则列表里会出现「有值但是空」的怪状态
      const payload = { ...v, requirement_ids: v.requirement_ids?.trim() || null };
      return editing
        ? updateFeature(editing.id, payload as FeatureInput)
        : createFeature(pid, payload);
    },
    onSuccess: () => {
      message.success(editing ? '功能已更新' : '功能已创建');
      setFormOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFeature(id),
    onSuccess: () => {
      message.success('功能已删除');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const releaseMutation = useMutation<Feature | BulkReleaseResult, unknown, string[]>({
    mutationFn: (ids) =>
      ids.length === 1 ? releaseFeature(ids[0], cascade) : bulkReleaseFeatures(ids, cascade),
    onSuccess: (result) => {
      if ('released' in result) {
        message.success(`已转正式 ${result.released.length} 个，跳过 ${result.skipped.length} 个`);
      } else {
        message.success('已转为正式');
      }
      setReleaseIds(null);
      setSelectedIds([]);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => reopenFeature(id),
    onSuccess: () => {
      message.success('已退回迭代');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  // 单行"转为正式"要先拿到最新功能，用不到单独接口，直接复用批量接口的单元素分支
  async function releaseSingle(id: string) {
    setReleaseIds([id]);
  }

  const iterationName = (id: string | null) => iterations.find((i) => i.id === id)?.name;

  return (
    <div style={{ padding: 20 }}>
      <ProCard title={project ? project.name : '项目'} extra={<Link to={`/teams/${project?.team_id ?? ''}`}>返回团队</Link>}>
        {project && (
          <ProDescriptions column={2} size="small">
            <ProDescriptions.Item label="编码">{project.code || '-'}</ProDescriptions.Item>
            <ProDescriptions.Item label="Base URL">{project.base_url || '-'}</ProDescriptions.Item>
            <ProDescriptions.Item label="描述" span={2}>
              {project.description || '-'}
            </ProDescriptions.Item>
          </ProDescriptions>
        )}
      </ProCard>

      <ModelConfigCard projectId={pid} />

      <ProCard style={{ marginTop: 16 }} title="环境与变量">
        <EnvironmentsCard projectId={pid} />
      </ProCard>

      <ProCard style={{ marginTop: 16 }} title="功能列表">
        <Space style={{ marginBottom: 16 }} wrap>
          <Segmented
            value={stage}
            onChange={(v) => {
              setStage(v as StageFilter);
              setSelectedIds([]);
            }}
            options={[
              { label: '全部', value: 'all' },
              { label: '当前迭代', value: 'in_iteration' },
              { label: '正式', value: 'released' },
            ]}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setFormOpen(true);
            }}
          >
            新建功能
          </Button>
          <Button
            disabled={selectedIds.length === 0}
            onClick={() => {
              setCascade(true);
              setReleaseIds(selectedIds);
            }}
          >
            批量转正式（{selectedIds.length}）
          </Button>
        </Space>

        <QaTable<Feature>
          rowKey="id"
          loading={isLoading}
          dataSource={features}
          pagination={PAGE}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as string[]),
          }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              sorter: byText<Feature>((r) => r.name),
              render: (name: string, r) => <Link to={`/features/${r.id}`}>{name}</Link>,
            },
            {
              title: '需求编号',
              dataIndex: 'requirement_ids',
              width: 160,
              sorter: byText<Feature>((r) => r.requirement_ids),
              render: (v: string | null) =>
                v ? (
                  <Space size={4} wrap>
                    {v.split(/[,，;；\s]+/).filter(Boolean).map((id) => (
                      <Tag key={id}>{id}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">-</Typography.Text>
                ),
            },
            {
              title: '分期',
              dataIndex: 'stage',
              width: 110,
              sorter: byRank<Feature>((r) => r.stage, ['in_iteration', 'released']),
              render: (s: FeatureStage) =>
                s === 'released' ? <Tag color="success">正式</Tag> : <Tag color="processing">当前迭代</Tag>,
            },
            {
              title: '迭代',
              dataIndex: 'iteration_id',
              sorter: byText<Feature>((r) => iterationName(r.iteration_id)),
              render: (v: string | null) => iterationName(v) ?? '-',
            },
            {
              title: '用例数',
              width: 90,
              sorter: byNumber<Feature>((r) => caseCounts[r.id] ?? 0),
              render: (_, r) => caseCounts[r.id] ?? 0,
            },
            {
              title: '操作',
              width: 260,
              render: (_, r) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(r);
                      form.setFieldsValue({
                        name: r.name,
                        description: r.description ?? undefined,
                        requirement_ids: r.requirement_ids ?? undefined,
                        iteration_id: r.iteration_id,
                      });
                      setFormOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  {r.stage === 'released' ? (
                    <Popconfirm title="退回迭代？" onConfirm={() => reopenMutation.mutate(r.id)}>
                      <Button size="small">退回迭代</Button>
                    </Popconfirm>
                  ) : (
                    <Button size="small" type="link" onClick={() => releaseSingle(r.id)}>
                      转为正式
                    </Button>
                  )}
                  <Popconfirm title="确定删除该功能？" onConfirm={() => deleteMutation.mutate(r.id)}>
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          已是正式的功能再次转正会返回 409，会被跳过。
        </Typography.Paragraph>
      </ProCard>

      <Modal
        title={editing ? '编辑功能' : '新建功能'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入功能名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="requirement_ids"
            label="需求编号"
            tooltip="禅道/Jira 里的需求编号。一个功能对应多个需求时用逗号分隔，例如 ZENTAO-1234, PROJ-88"
          >
            <Input placeholder="可留空；多个用逗号分隔" allowClear />
          </Form.Item>
          <Form.Item name="iteration_id" label="所属迭代">
            <Select
              allowClear
              placeholder="可不选"
              options={iterations.map((i) => ({ value: i.id, label: i.name }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={releaseIds && releaseIds.length > 1 ? `批量转正式（${releaseIds.length} 个）` : '转为正式'}
        open={releaseIds !== null}
        onCancel={() => setReleaseIds(null)}
        onOk={() => releaseIds && releaseMutation.mutate(releaseIds)}
        confirmLoading={releaseMutation.isPending}
      >
        <Space direction="vertical">
          <Typography.Text>将功能从「当前迭代」转为「正式」。</Typography.Text>
          <Space>
            <Switch checked={cascade} onChange={setCascade} />
            <span>级联转正其下用例</span>
          </Space>
        </Space>
      </Modal>
    </div>
  );
}
