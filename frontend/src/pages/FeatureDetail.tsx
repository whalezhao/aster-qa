import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { createCase, deleteCase, getCases, type CaseInput } from '../api/cases';
import { getFeature } from '../api/features';
import ModelConfigNotice from '../components/ModelConfigNotice';
import { apiError } from '../api/client';
import { PAGE, byRank, byText } from '../lib/table';
import type { FeatureStage, Priority, TestCase } from '../api/types';
import QaTable from '../components/QaTable';
import { t } from '../i18n';

const DEFAULT_YAML = `cases:
  - name: 示例用例
    steps:
      - ai: 打开首页
      - aiAssert: 页面正常加载
`;

const priorityOptions = (['P0', 'P1', 'P2', 'P3'] as Priority[]).map((p) => ({ value: p, label: p }));

interface CaseFormValues {
  name: string;
  yaml_content: string;
  description?: string;
  priority?: Priority | null;
  defect_ids?: string;
  stage_override?: FeatureStage | null;
}

export default function FeatureDetail() {
  const { fid = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CaseFormValues>();

  const { data: feature } = useQuery({ queryKey: ['feature', fid], queryFn: () => getFeature(fid) });
  const { data: cases = [], isLoading } = useQuery({ queryKey: ['cases', fid], queryFn: () => getCases(fid) });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['cases', fid] });

  const saveMutation = useMutation({
    mutationFn: (v: CaseFormValues) =>
      createCase(fid, {
        ...v,
        defect_ids: v.defect_ids?.trim() || null,
      } as Required<Pick<CaseInput, 'name' | 'yaml_content'>> & CaseInput),
    onSuccess: () => {
      message.success(t('用例已创建'));
      setOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCase(id),
    onSuccess: () => {
      message.success(t('用例已删除'));
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <div style={{ padding: 20 }}>
      <ModelConfigNotice projectId={feature?.project_id} action={t('执行该功能下的用例')} />
      <ProCard
        title={feature ? feature.name : t('功能')}
        extra={<Link to={`/projects/${feature?.project_id ?? ''}`}>{t('返回系统')}</Link>}
      >
        {feature && (
          <ProDescriptions column={2} size="small">
            <ProDescriptions.Item label={t('分期')}>
              {feature.stage === 'released' ? <Tag color="success">{t('正式')}</Tag> : <Tag color="processing">{t('当前迭代')}</Tag>}
            </ProDescriptions.Item>
            <ProDescriptions.Item label={t('描述')}>{feature.description || '-'}</ProDescriptions.Item>
          </ProDescriptions>
        )}
      </ProCard>

      <ProCard
        style={{ marginTop: 16 }}
        title={t('测试用例')}
        extra={
          <Space>
            {/* 主入口走对话生成 —— 不用懂 YAML 也能建用例 */}
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={() => navigate(`/cases/new/${fid}`)}
            >
              {t('用 AI 新建用例')}
            </Button>
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ yaml_content: DEFAULT_YAML });
                setOpen(true);
              }}
            >
              {t('手动写 YAML')}
            </Button>
          </Space>
        }
      >
        <QaTable<TestCase>
          rowKey="id"
          loading={isLoading}
          dataSource={cases}
          pagination={PAGE}
          columns={[
            {
              title: t('名称'),
              dataIndex: 'name',
              sorter: byText<TestCase>((r) => r.name),
              // 点名字进 AI 页 —— 改用例的主路径是对话，不是手写 YAML
              render: (name: string, r) => <Link to={`/cases/${r.id}/ai`}>{name}</Link>,
            },
            {
              title: t('优先级'),
              dataIndex: 'priority',
              width: 100,
              sorter: byRank<TestCase>((r) => r.priority ?? '', ['P0', 'P1', 'P2', 'P3']),
              render: (v: Priority | null) => v ?? '-',
            },
            {
              title: t('缺陷编号'),
              dataIndex: 'defect_ids',
              width: 150,
              sorter: byText<TestCase>((r) => r.defect_ids),
              render: (v: string | null) =>
                v ? (
                  <Space size={4} wrap>
                    {v.split(/[,，;；\s]+/).filter(Boolean).map((id) => (
                      <Tag key={id} color="warning">
                        {id}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">-</Typography.Text>
                ),
            },
            {
              title: t('分期'),
              width: 110,
              sorter: byRank<TestCase>((r) => r.effective_stage, ['in_iteration', 'released']),
              render: (_, r) =>
                r.effective_stage === 'released' ? (
                  <Tag color="success">{t('正式')}</Tag>
                ) : (
                  <Tag color="processing">{t('当前迭代')}</Tag>
                ),
            },
            {
              title: t('描述'),
              dataIndex: 'description',
              sorter: byText<TestCase>((r) => r.description),
              render: (v: string | null) => v || '-',
            },
            {
              title: t('操作'),
              width: 250,
              render: (_, r) => (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    icon={<RobotOutlined />}
                    onClick={() => navigate(`/cases/${r.id}/ai`)}
                  >
                    {t('AI 改')}
                  </Button>
                  <Link to={`/cases/${r.id}`}>
                    <Button size="small" type="text">
                      {t('详情')}
                    </Button>
                  </Link>
                  <Popconfirm title={t('确定删除该用例？')} onConfirm={() => deleteMutation.mutate(r.id)}>
                    <Button size="small" type="text" danger>
                      {t('删除')}
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          {t('用例内容为自然语言 YAML。建用例和改用例都走 AI 对话；手写 YAML 只在 AI 改不动时用（在「详情」里）。')}
        </Typography.Paragraph>
      </ProCard>

      <Modal
        title={t('新建用例')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        width={720}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} preserve={false}>
          <Form.Item name="name" label={t('名称')} rules={[{ required: true, message: t('请输入用例名称') }]}>
            <Input />
          </Form.Item>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="priority" label={t('优先级')} style={{ width: 160 }}>
              <Select allowClear options={priorityOptions} placeholder={t('可不选')} />
            </Form.Item>
            <Form.Item
              name="defect_ids"
              label={t('缺陷编号')}
              style={{ width: 280 }}
              tooltip={t('这条用例是为哪个缺陷补的（禅道/Jira 的 bug 单号）。多个用逗号分隔')}
            >
              <Input placeholder={t('可留空；多个用逗号分隔')} allowClear />
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
          </Space>
          <Form.Item name="description" label={t('描述')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="yaml_content" label={t('YAML 内容')} rules={[{ required: true, message: t('请输入 YAML 内容') }]}>
            <Input.TextArea rows={12} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
