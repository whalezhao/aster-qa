import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createEnvironmentDataSource,
  deleteEnvironmentDataSource,
  getEnvironmentDataSources,
  testEnvironmentDataSource,
  updateEnvironmentDataSource,
} from '../api/datasources';
import { apiError } from '../api/client';
import { t } from '../i18n';
import type {
  DataSourceDialect,
  Environment,
  EnvironmentDataSource,
  EnvironmentDataSourceInput,
} from '../api/types';

interface FormValues extends EnvironmentDataSourceInput {
  password?: string;
}

const DEFAULTS: FormValues = {
  name: '',
  dialect: 'mysql',
  host: '',
  port: 3306,
  database: '',
  username: '',
  password: '',
  ssl: false,
  charset: 'utf8mb4',
  connect_timeout_ms: 5000,
  statement_timeout_ms: 5000,
  max_rows: 100,
};

export default function EnvironmentDataSourcesModal({
  env,
  onClose,
}: {
  env: Environment | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EnvironmentDataSource | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['environment-datasources', env?.id],
    queryFn: () => getEnvironmentDataSources(env!.id),
    enabled: Boolean(env),
  });

  useEffect(() => {
    if (!env) {
      setFormOpen(false);
      setEditing(null);
    }
  }, [env]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['environment-datasources', env?.id] });
    queryClient.invalidateQueries({ queryKey: ['project-datasources'] });
  };

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue(DEFAULTS);
    setFormOpen(true);
  };

  const openEdit = (row: EnvironmentDataSource) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      dialect: row.dialect,
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password: '',
      ssl: row.ssl,
      charset: row.charset,
      connect_timeout_ms: row.connect_timeout_ms,
      statement_timeout_ms: row.statement_timeout_ms,
      max_rows: row.max_rows,
    });
    setFormOpen(true);
  };

  const payload = (values: FormValues): EnvironmentDataSourceInput => ({
    ...values,
    password: values.password?.trim() ? values.password : null,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? updateEnvironmentDataSource(env!.id, editing.id, payload(values))
        : createEnvironmentDataSource(env!.id, payload(values)),
    onSuccess: () => {
      message.success(editing ? t('数据源已更新') : t('数据源已创建'));
      setFormOpen(false);
      refresh();
    },
    onError: (error) => message.error(apiError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEnvironmentDataSource(env!.id, id),
    onSuccess: () => {
      message.success(t('数据源已删除'));
      refresh();
    },
    onError: (error) => message.error(apiError(error)),
  });

  const test = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      return testEnvironmentDataSource(env!.id, {
        ...payload(values),
        id: editing?.id,
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        message.success(
          t('连接成功{latency}{version}', {
            latency: result.latency_ms == null ? '' : `，${result.latency_ms}ms`,
            version: result.server_version ? `，${result.server_version}` : '',
          }),
        );
      } else {
        message.error(result.message || t('连接失败'));
      }
    },
    onError: (error) => message.error(apiError(error)),
  });

  return (
    <>
      <Modal
        open={Boolean(env)}
        title={t('数据库 · {name}', { name: env?.name ?? '' })}
        width={1000}
        zIndex={1000}
        onCancel={onClose}
        footer={<Button onClick={onClose}>{t('关闭')}</Button>}
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('新建数据源')}
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('用例里用 dbAssert.datasource 引用名称；建议使用只读账号。')}
          </Typography.Text>
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          dataSource={rows}
          pagination={false}
          columns={[
            {
              title: t('名称'),
              dataIndex: 'name',
              width: 140,
              render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
            },
            {
              title: t('类型'),
              dataIndex: 'dialect',
              width: 100,
              render: (value: DataSourceDialect) => (
                <Tag
                  color={
                    value === 'oceanbase'
                      ? 'geekblue'
                      : value === 'postgres'
                        ? 'purple'
                        : 'blue'
                  }
                >
                  {value === 'oceanbase'
                    ? 'OceanBase'
                    : value === 'postgres'
                      ? 'PostgreSQL'
                      : 'MySQL'}
                </Tag>
              ),
            },
            {
              title: t('地址'),
              dataIndex: 'host',
              render: (_value, row) => `${row.host}:${row.port}/${row.database}`,
            },
            { title: t('账号'), dataIndex: 'username', width: 130 },
            {
              title: t('密码'),
              dataIndex: 'password_set',
              width: 90,
              render: (value: boolean) =>
                value ? <Tag color="green">{t('已设置')}</Tag> : '-',
            },
            {
              title: t('操作'),
              width: 200,
              render: (_value, row) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(row)}>
                    {t('编辑')}
                  </Button>
                  <Popconfirm
                    title={t('删除这个数据源？')}
                    onConfirm={() => remove.mutate(row.id)}
                  >
                    <Button size="small" danger loading={remove.isPending}>
                      {t('删除')}
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={formOpen}
        title={editing ? t('编辑数据源') : t('新建数据源')}
        zIndex={1100}
        onCancel={() => setFormOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        width={720}
        forceRender
        footer={
          <Space>
            <Button onClick={() => setFormOpen(false)}>{t('取消')}</Button>
            <Button loading={test.isPending} onClick={() => test.mutate()}>
              {t('测试连接')}
            </Button>
            <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
              {t('保存')}
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={DEFAULTS}
          onFinish={(values) => save.mutate(values)}
        >
          <Space size={12} wrap>
            <Form.Item
              name="name"
              label={t('名称')}
              rules={[
                { required: true, message: t('必填') },
                {
                  pattern: /^[A-Za-z_][A-Za-z0-9_]{0,31}$/,
                  message: t('字母或下划线开头，最多 32 位'),
                },
              ]}
            >
              <Input style={{ width: 180 }} placeholder="QA_DB" />
            </Form.Item>
            <Form.Item name="dialect" label={t('类型')}>
              <Select
                style={{ width: 150 }}
                onChange={(dialect: DataSourceDialect) =>
                  form.setFieldValue(
                    'port',
                    dialect === 'oceanbase'
                      ? 2883
                      : dialect === 'postgres'
                        ? 5432
                        : 3306,
                  )
                }
                options={[
                  { value: 'mysql', label: 'MySQL' },
                  { value: 'oceanbase', label: 'OceanBase' },
                  { value: 'postgres', label: 'PostgreSQL' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="host"
              label={t('主机')}
              rules={[{ required: true, message: t('必填') }]}
            >
              <Input style={{ width: 220 }} placeholder="10.0.0.10" />
            </Form.Item>
            <Form.Item
              name="port"
              label={t('端口')}
              rules={[{ required: true, message: t('必填') }]}
            >
              <InputNumber min={1} max={65535} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          <Space size={12} wrap>
            <Form.Item
              name="database"
              label={t('数据库')}
              rules={[{ required: true, message: t('必填') }]}
            >
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              name="username"
              label={t('用户名')}
              rules={[{ required: true, message: t('必填') }]}
            >
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              name="password"
              label={t('密码')}
              rules={
                editing
                  ? []
                  : [{ required: true, message: t('必填') }]
              }
            >
              <Input.Password
                style={{ width: 220 }}
                placeholder={editing ? t('留空表示不修改') : ''}
              />
            </Form.Item>
            <Form.Item name="ssl" label="SSL" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Space size={12} wrap>
            <Form.Item name="charset" label={t('字符集')}>
              <Input style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="connect_timeout_ms" label={t('连接超时 ms')}>
              <InputNumber min={500} max={60000} step={500} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="statement_timeout_ms" label={t('查询超时 ms')}>
              <InputNumber min={500} max={600000} step={500} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="max_rows" label={t('最大返回行数')}>
              <InputNumber min={1} max={10000} style={{ width: 140 }} />
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('OceanBase 请使用 MySQL 兼容模式；MySQL/OceanBase 参数用 ?，PostgreSQL 用 $1；建议只授予 SELECT 权限。')}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  );
}