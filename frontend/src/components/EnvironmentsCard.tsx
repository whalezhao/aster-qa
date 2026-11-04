import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createEnvironment,
  deleteEnvironment,
  getProjectEnvironments,
  setEnvironmentVariables,
  updateEnvironment,
} from '../api/environments';
import { apiError } from '../api/client';
import { t } from '../i18n';
import type { Environment, EnvironmentVariableInput } from '../api/types';

interface VariableRow {
  key: string;
  value: string;
  is_secret: boolean;
  existing: boolean;
  clear: boolean;
  description?: string | null;
  value_set?: boolean;
}

function VariablesModal({
  env,
  onClose,
}: {
  env: Environment | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<VariableRow[]>([]);

  useEffect(() => {
    if (!env) return;
    setRows(
      env.variables.map((item) => ({
        key: item.key,
        value: item.is_secret ? '' : item.value ?? '',
        is_secret: item.is_secret,
        existing: true,
        clear: false,
        description: item.description,
        value_set: item.value_set,
      })),
    );
  }, [env]);

  const save = useMutation({
    mutationFn: () => {
      const variables: EnvironmentVariableInput[] = rows
        .filter((row) => row.key.trim())
        .map((row) => ({
          key: row.key.trim(),
          value: row.value,
          is_secret: row.is_secret,
          description: row.description ?? null,
          clear: row.clear,
        }));
      return setEnvironmentVariables(env!.id, variables);
    },
    onSuccess: () => {
      message.success(t('变量已保存'));
      queryClient.invalidateQueries({ queryKey: ['environments', env?.project_id] });
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const update = (index: number, patch: Partial<VariableRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Modal
      open={Boolean(env)}
      title={t('环境变量 · {name}', { name: env?.name ?? '' })}
      width={760}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('保存变量')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('普通变量在 YAML 里用')} <Typography.Text code>{'${KEY}'}</Typography.Text>{' '}
        {t('引用；密钥用')} <Typography.Text code>{'${{KEY}}'}</Typography.Text>{' '}
        {t('引用，只注入进程环境，不写进配置文件。密钥留空表示不修改。')}
      </Typography.Paragraph>
      <Table
        size="small"
        pagination={false}
        rowKey={(_, index) => String(index)}
        dataSource={rows}
        columns={[
          {
            title: t('变量名'),
            width: 180,
            render: (_value, row, index) => (
              <Input
                value={row.key}
                disabled={row.existing}
                onChange={(e) => update(index, { key: e.target.value })}
              />
            ),
          },
          {
            title: t('值'),
            render: (_value, row, index) => (
              <Input
                value={row.value}
                disabled={row.clear}
                placeholder={row.existing && row.is_secret ? t('留空 = 不修改') : ''}
                onChange={(e) => update(index, { value: e.target.value })}
              />
            ),
          },
          {
            title: t('密钥'),
            width: 90,
            render: (_value, row, index) => (
              <Switch
                size="small"
                checked={row.is_secret}
                disabled={row.existing}
                onChange={(checked) => update(index, { is_secret: checked })}
              />
            ),
          },
          {
            title: t('操作'),
            width: 120,
            render: (_value, row, index) =>
              row.existing ? (
                <Checkbox
                  checked={row.clear}
                  onChange={(e) => update(index, { clear: e.target.checked })}
                >
                  {t('删除')}
                </Checkbox>
              ) : (
                <Button
                  size="small"
                  danger
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                >
                  {t('移除')}
                </Button>
              ),
          },
        ]}
      />
      <Button
        style={{ marginTop: 12 }}
        icon={<PlusOutlined />}
        onClick={() =>
          setRows((prev) => [
            ...prev,
            { key: '', value: '', is_secret: false, existing: false, clear: false },
          ])
        }
      >
        {t('添加变量')}
      </Button>
    </Modal>
  );
}

/** 系统环境与变量管理卡片。 */
export default function EnvironmentsCard({ projectId }: { projectId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Environment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [variablesFor, setVariablesFor] = useState<Environment | null>(null);

  const { data: environments = [], isLoading } = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => getProjectEnvironments(projectId),
    enabled: Boolean(projectId),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = (env: Environment) => {
    setEditing(env);
    form.setFieldsValue({ name: env.name, base_url: env.base_url });
    setFormOpen(true);
  };

  const save = useMutation({
    mutationFn: (values: { name: string; base_url?: string }) =>
      editing
        ? updateEnvironment(editing.id, values)
        : createEnvironment(projectId, values),
    onSuccess: () => {
      message.success(editing ? t('环境已更新') : t('环境已创建'));
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['environments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['team-environments'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEnvironment(id),
    onSuccess: () => {
      message.success(t('环境已删除'));
      queryClient.invalidateQueries({ queryKey: ['environments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['team-environments'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t('新建环境')}
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('任务按环境名执行；跨系统任务要求每个系统都有同名环境。')}
        </Typography.Text>
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        pagination={false}
        dataSource={environments}
        columns={[
          {
            title: t('名称'),
            dataIndex: 'name',
            render: (name: string, row) => (
              <Space>
                <Typography.Text strong>{name}</Typography.Text>
                {row.is_default && <Tag color="blue">{t('默认')}</Tag>}
              </Space>
            ),
          },
          {
            title: 'Base URL',
            dataIndex: 'base_url',
            render: (value: string | null) => value || '-',
          },
          {
            title: t('变量'),
            dataIndex: 'variables',
            width: 90,
            render: (value: Environment['variables']) => value.length,
          },
          {
            title: t('操作'),
            width: 220,
            render: (_value, row) => (
              <Space>
                <Button size="small" onClick={() => setVariablesFor(row)}>
                  {t('变量')}
                </Button>
                <Button size="small" onClick={() => openEdit(row)}>
                  {t('编辑')}
                </Button>
                {!row.is_default && (
                  <Popconfirm
                    title={t('删除这个环境？')}
                    description={t('仍有任务使用该环境名时会被拒绝。')}
                    onConfirm={() => remove.mutate(row.id)}
                  >
                    <Button size="small" danger loading={remove.isPending}>
                      {t('删除')}
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={formOpen}
        title={editing ? t('编辑环境') : t('新建环境')}
        onCancel={() => setFormOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item
            name="name"
            label={t('环境名')}
            rules={[{ required: true, message: t('必填') }]}
            extra={editing?.is_default ? t('默认环境不能改名') : undefined}
          >
            <Input disabled={editing?.is_default} placeholder={t('如 staging')} />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Base URL"
            extra={editing?.is_default ? t('默认环境地址跟随系统 Base URL') : undefined}
          >
            <Input disabled={editing?.is_default} placeholder="https://staging.example.com" />
          </Form.Item>
        </Form>
      </Modal>
      <VariablesModal env={variablesFor} onClose={() => setVariablesFor(null)} />
    </div>
  );
}
