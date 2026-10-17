import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createApiToken, getApiTokens, revokeApiToken } from '../../api/apiTokens';
import { apiError } from '../../api/client';
import { fmtDateTime } from '../../lib/format';
import type { ApiTokenCreated } from '../../api/types';

export default function ApiTokensTab({ tid }: { tid: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['api-tokens', tid],
    queryFn: () => getApiTokens(tid),
    enabled: Boolean(tid),
  });

  const create = useMutation({
    mutationFn: (values: { name: string; scopes: string[] }) =>
      createApiToken(tid, { name: values.name, scopes: values.scopes }),
    onSuccess: (result) => {
      setOpen(false);
      setCreated(result);
      queryClient.invalidateQueries({ queryKey: ['api-tokens', tid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiToken(tid, id),
    onSuccess: () => {
      message.success('Token 已吊销');
      queryClient.invalidateQueries({ queryKey: ['api-tokens', tid] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="给 CI 使用的团队 Token"
        description={
          <span>
            在 CI 里通过 <Typography.Text code>X-API-Token</Typography.Text> 或
            <Typography.Text code>Authorization: Bearer aqt_...</Typography.Text> 调用
            <Typography.Text code>POST /api/ci/tasks/&lt;id&gt;/run</Typography.Text> 和
            <Typography.Text code>GET /api/ci/batches/&lt;id&gt;</Typography.Text>。
            明文只在创建时显示一次。
          </span>
        }
      />
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ scopes: ['run', 'read'] });
            setOpen(true);
          }}
        >
          新建 Token
        </Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        pagination={false}
        dataSource={tokens}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '前缀',
            dataIndex: 'token_prefix',
            render: (value: string) => <Typography.Text code>{value}…</Typography.Text>,
          },
          {
            title: '权限',
            dataIndex: 'scopes',
            render: (scopes: string[]) => (
              <Space>{scopes.map((s) => <Tag key={s}>{s}</Tag>)}</Space>
            ),
          },
          {
            title: '最近使用',
            dataIndex: 'last_used_at',
            render: (value: string | null) => fmtDateTime(value),
          },
          {
            title: '状态',
            render: (_value, row) =>
              row.revoked_at ? <Tag>已吊销</Tag> : <Tag color="green">有效</Tag>,
          },
          {
            title: '操作',
            width: 100,
            render: (_value, row) =>
              !row.revoked_at && (
                <Popconfirm
                  title="吊销这个 Token？"
                  description="吊销后使用它的 CI 任务会立即失败。"
                  onConfirm={() => revoke.mutate(row.id)}
                >
                  <Button size="small" danger loading={revoke.isPending}>
                    吊销
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />

      <Modal
        open={open}
        title="新建 CI Token"
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="如 GitHub Actions" />
          </Form.Item>
          <Form.Item name="scopes" label="权限">
            <Checkbox.Group
              options={[
                { label: 'run（触发执行）', value: 'run' },
                { label: 'read（查询状态/预检）', value: 'read' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(created)}
        title="Token 已创建"
        onCancel={() => setCreated(null)}
        footer={<Button onClick={() => setCreated(null)}>我已保存</Button>}
      >
        <Alert
          type="warning"
          showIcon
          message="这是唯一一次显示明文"
          description="关闭后无法再查看，只能重新创建。"
          style={{ marginBottom: 16 }}
        />
        <Typography.Paragraph copyable={{ text: created?.token }} code>
          {created?.token}
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
