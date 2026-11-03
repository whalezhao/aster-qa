import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiError } from '../../api/client';
import { fmtDateTime } from '../../lib/format';
import { PAGE, byDate, byNumber, byText } from '../../lib/table';
import { t } from '../../i18n';
import {
  createWebhook,
  deleteWebhook,
  getDeliveries,
  getWebhookEvents,
  getWebhooks,
  redeliver,
  testWebhook,
  updateWebhook,
  type WebhookInput } from '../../api/webhooks';
import type { Webhook, WebhookDelivery } from '../../api/types';
import QaTable from '../../components/QaTable';

export default function WebhooksTab({ tid }: { tid: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [viewing, setViewing] = useState<Webhook | null>(null);
  const [form] = Form.useForm<WebhookFormValues>();
  const kind = Form.useWatch('kind', form) ?? 'generic';

  const { data: hooks = [], isLoading } = useQuery({
    queryKey: ['webhooks', tid],
    queryFn: () => getWebhooks(tid),
  });
  const { data: eventTypes = [] } = useQuery({
    queryKey: ['webhook-events'],
    queryFn: getWebhookEvents,
  });
  const eventLabel = (e: string) => t(eventTypes.find((item) => item.event === e)?.label ?? e);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['webhooks', tid] });

  const save = useMutation({
    mutationFn: (v: WebhookFormValues) =>
      editing
        ? updateWebhook(editing.id, { ...v, secret: v.secret || undefined })
        : createWebhook(tid, v as WebhookInput),
    onSuccess: () => {
      message.success(editing ? t('webhook 已更新') : t('webhook 已创建'));
      setOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: () => {
      message.success(t('webhook 已删除'));
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const test = useMutation({
    mutationFn: (id: string) => testWebhook(id),
    onSuccess: () => {
      message.success(t('已排队投递，几秒后到「投递记录」里看结果'));
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('签名、执行完成时会 POST 到这里')}
        description={
          <>
            {t('请求头带')} <Typography.Text code>X-QA-Token</Typography.Text> {t('（你配的密钥）和')}{' '}
            <Typography.Text code>X-QA-Signature: sha256=…</Typography.Text>
            {t('—— 后者是对「X-QA-Timestamp.body 的原始字节」做 HMAC-SHA256，接收方要按原始字节验。投递失败按 1m→2m→4m→8m→16m→30m 重试共 6 次，失败原因在「投递记录」里。')}
          </>
        }
      />
      <Button
        type="primary"
        icon={<PlusOutlined />}
        style={{ marginBottom: 16 }}
        onClick={() => {
          setEditing(null);
          form.resetFields();
          form.setFieldsValue({
            events: ['task.signed'],
            kind: 'generic',
            include_yaml: false,
            is_active: true,
          });
          setOpen(true);
        }}
      >
        {t('新建 webhook')}
      </Button>

      <QaTable<Webhook>
        rowKey="id"
        loading={isLoading}
        dataSource={hooks}
        pagination={PAGE}
        locale={{ emptyText: t('还没有配置 webhook') }}
        columns={[
          { title: t('名称'), dataIndex: 'name', sorter: byText<Webhook>((h) => h.name) },
          {
            title: t('类型'),
            dataIndex: 'kind',
            width: 110,
            render: (value: Webhook['kind']) => (
              <Tag>
                {
                  {
                    generic: t('通用'),
                    wecom: t('企业微信'),
                    feishu: t('飞书'),
                    dingtalk: t('钉钉'),
                    slack: 'Slack',
                  }[value] ?? value
                }
              </Tag>
            ),
          },
          { title: t('地址'), dataIndex: 'url', ellipsis: true, sorter: byText<Webhook>((h) => h.url) },
          {
            title: t('订阅事件'),
            render: (_, h) => (
              <Space size={4} wrap>
                {h.events.map((e) => (
                  <Tag key={e}>{eventLabel(e)}</Tag>
                ))}
              </Space>
            ),
          },
          {
            title: t('状态'),
            width: 90,
            sorter: byNumber<Webhook>((h) => (h.is_active ? 1 : 0)),
            render: (_, h) => (h.is_active ? <Tag color="success">{t('启用')}</Tag> : <Tag>{t('停用')}</Tag>),
          },
          {
            title: t('最近投递'),
            width: 190,
            sorter: byDate<Webhook>((h) => h.last_delivery_at),
            render: (_, h) =>
              h.last_delivery_at ? (
                <Space size={4}>
                  <Tag
                    color={
                      h.last_delivery_status === 'success'
                        ? 'success'
                        : h.last_delivery_status === 'pending'
                          ? 'processing'
                          : 'error'
                    }
                  >
                    {h.last_delivery_status === 'success'
                      ? t('成功')
                      : h.last_delivery_status === 'pending'
                        ? t('重试中')
                        : t('失败')}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtDateTime(h.last_delivery_at)}
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Text type="secondary">{t('还没投过')}</Typography.Text>
              ),
          },
          {
            title: t('操作'),
            width: 250,
            render: (_, h) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(h);
                    form.setFieldsValue({
                      name: h.name,
                      kind: h.kind,
                      url: h.url,
                      secret: undefined,
                      events: h.events,
                      include_yaml: h.include_yaml,
                      is_active: h.is_active,
                    });
                    setOpen(true);
                  }}
                >
                  {t('编辑')}
                </Button>
                <Button
                  size="small"
                  loading={test.isPending && test.variables === h.id}
                  onClick={() => test.mutate(h.id)}
                >
                  {t('测试')}
                </Button>
                <Button size="small" onClick={() => setViewing(h)}>
                  {t('投递记录')}
                </Button>
                <Popconfirm
                  title={t('删除后不再投递，投递记录也一并删掉')}
                  onConfirm={() => remove.mutate(h.id)}
                >
                  <Button size="small" danger>
                    {t('删除')}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? t('编辑 webhook') : t('新建 webhook')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        width={560}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} preserve={false}>
          <Form.Item
            name="name"
            label={t('名称')}
            rules={[{ required: true, message: t('给这个 webhook 起个名字') }]}
          >
            <Input placeholder={t('例如：禅道同步')} />
          </Form.Item>
          <Form.Item name="kind" label={t('渠道类型')}>
            <Select
              options={[
                { value: 'generic', label: t('通用 Webhook（HMAC 签名）') },
                { value: 'wecom', label: t('企业微信机器人') },
                { value: 'feishu', label: t('飞书机器人') },
                { value: 'dingtalk', label: t('钉钉机器人') },
                { value: 'slack', label: 'Slack Incoming Webhook' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="url"
            label={kind === 'generic' ? t('地址') : t('机器人 Webhook 地址')}
            rules={[
              { required: true, message: t('请输入接收地址') },
              { pattern: /^https?:\/\//, message: t('要以 http:// 或 https:// 开头') },
            ]}
          >
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item
            name="secret"
            label={
              kind === 'generic'
                ? editing
                  ? t('密钥（留空则不修改）')
                  : t('密钥')
                : t('签名密钥（可选）')
            }
            tooltip={
              kind === 'generic'
                ? t('接收方拿它比对 X-QA-Token，并用它验 HMAC 签名。存进去之后读不回来，只能改。')
                : t('钉钉/飞书机器人开启了「加签」时才需要填。')
            }
            rules={
              kind === 'generic' && !editing
                ? [
                    { required: true, message: t('请设置密钥') },
                    { min: 8, message: t('至少 8 位') },
                  ]
                : []
            }
          >
            <Input.Password placeholder={editing ? t('留空则不修改') : kind === 'generic' ? t('必填') : t('可选')} />
          </Form.Item>
          <Form.Item name="events" label={t('订阅事件')} rules={[{ required: true, message: t('至少选一个') }]}>
            <Select
              mode="multiple"
              placeholder={t('选择要投递的事件')}
              options={eventTypes.map((item) => ({ value: item.event, label: t(item.label ?? item.event) }))}
            />
          </Form.Item>
          <Space size={24}>
            <Form.Item name="is_active" label={t('启用')} valuePropName="checked">
              <Switch />
            </Form.Item>
            {kind === 'generic' && (
              <Form.Item
                name="include_yaml"
                label={t('连用例 YAML 一起发')}
                valuePropName="checked"
                tooltip={t('默认不发正文（用例多的时候 payload 会到几百 KB）。接收方需要正文时才开')}
              >
                <Switch />
              </Form.Item>
            )}
          </Space>
        </Form>
      </Modal>

      <DeliveriesModal hook={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

export function DeliveriesModal({ hook, onClose }: { hook: Webhook | null; onClose: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['webhook-deliveries', hook?.id],
    queryFn: () => getDeliveries(hook!.id),
    enabled: Boolean(hook),
    // 投递是异步的，打开着就自动刷 —— 点完「测试」不用手动刷新
    refetchInterval: hook ? 4000 : false,
  });

  const again = useMutation({
    mutationFn: (id: string) => redeliver(hook!.id, id),
    onSuccess: () => {
      message.success(t('已重新排队'));
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', hook?.id] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <Modal
      title={t('投递记录 · {name}', { name: hook?.name ?? '' })}
      open={Boolean(hook)}
      onCancel={onClose}
      footer={null}
      width={1040}
    >
      <QaTable<WebhookDelivery>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={rows}
        pagination={PAGE}
        locale={{ emptyText: t('还没有投递记录') }}
        columns={[
          {
            title: t('时间'),
            dataIndex: 'created_at',
            width: 165,
            sorter: byDate<WebhookDelivery>((d) => d.created_at),
            render: (v: string) => fmtDateTime(v),
          },
          { title: t('事件'), dataIndex: 'event', width: 140 },
          {
            title: t('结果'),
            width: 150,
            render: (_, d) => (
              <Tag
                color={
                  d.status === 'success' ? 'success' : d.status === 'pending' ? 'processing' : 'error'
                }
              >
                {d.status === 'success'
                  ? t('成功 {status}', { status: d.response_status ?? '' })
                  : d.status === 'pending'
                    ? t('第 {n} 次待投', { n: d.attempts + 1 })
                    : t('失败')}
              </Tag>
            ),
          },
          {
            // 这一列的内容是一整段 JSON / 报错原文：必须给定宽度 + 单行省略，
            // 否则 antd 的自动布局会按最长内容把整张表撑出弹窗（实测溢出 100+px）
            title: t('响应 / 错误'),
            width: 420,
            ellipsis: true,
            render: (_, d) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {d.error ?? d.response_snippet ?? '-'}
              </Typography.Text>
            ),
          },
          {
            title: t('操作'),
            width: 90,
            render: (_, d) => (
              <Button size="small" onClick={() => again.mutate(d.id)}>
                {t('重发')}
              </Button>
            ),
          },
        ]}
      />
    </Modal>
  );
}

// --------------------------------------------------------------------------- Webhook

interface WebhookFormValues {
  name: string;
  kind: 'generic' | 'wecom' | 'feishu' | 'dingtalk' | 'slack';
  url: string;
  secret?: string;
  events: string[];
  include_yaml?: boolean;
  is_active?: boolean;
}

/**
 * 团队级的 webhook：形如 GitLab —— 一个地址勾选订阅哪些事件。
 *
 * 目前触发的是「任务签名」和「一次执行完成」两个事件，都发生在**人工/终态**时刻，
 * 不是数据一改就发（那样噪音太大）。
 */

