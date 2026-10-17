import { useEffect } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteSchedule, getSchedule, saveSchedule } from '../api/schedules';
import { apiError } from '../api/client';
import { fmtDateTime } from '../lib/format';

const PRESETS = [
  { label: '每 5 分钟', cron: '*/5 * * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每天 02:00', cron: '0 2 * * *' },
  { label: '每周一 09:00', cron: '0 9 * * 1' },
];

const TIMEZONES = [
  'Asia/Shanghai',
  'UTC',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
];

export default function TaskScheduleTab({ taskId }: { taskId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({
    queryKey: ['task-schedule', taskId],
    queryFn: () => getSchedule(taskId),
    enabled: Boolean(taskId),
  });

  useEffect(() => {
    form.setFieldsValue({
      enabled: data?.enabled ?? false,
      cron: data?.cron ?? '0 2 * * *',
      timezone: data?.timezone ?? 'Asia/Shanghai',
    });
  }, [data, form]);

  const save = useMutation({
    mutationFn: (values: { enabled: boolean; cron: string; timezone: string }) =>
      saveSchedule(taskId, values),
    onSuccess: () => {
      message.success('定时计划已保存');
      queryClient.invalidateQueries({ queryKey: ['task-schedule', taskId] });
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteSchedule(taskId),
    onSuccess: () => {
      message.success('定时计划已删除');
      form.setFieldsValue({ enabled: false });
      queryClient.invalidateQueries({ queryKey: ['task-schedule', taskId] });
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="定时回归"
        description="到点自动触发一次执行；任务正在执行时本次会跳过，不会叠加排队。"
      />
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => save.mutate(values)}
        initialValues={{ enabled: false, cron: '0 2 * * *', timezone: 'Asia/Shanghai' }}
      >
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="cron"
          label="cron 表达式（分 时 日 月 周）"
          rules={[{ required: true, message: '必填' }]}
        >
          <Input placeholder="0 2 * * *" />
        </Form.Item>
        <Space wrap style={{ marginBottom: 16 }}>
          {PRESETS.map((item) => (
            <Button key={item.cron} size="small" onClick={() => form.setFieldValue('cron', item.cron)}>
              {item.label}
            </Button>
          ))}
        </Space>
        <Form.Item name="timezone" label="时区" rules={[{ required: true }]}>
          <Input placeholder="Asia/Shanghai" />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          可选：{TIMEZONES.join('、')}。保存后由后端计算下次执行时间。
        </Typography.Paragraph>
        <Space>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存计划
          </Button>
          {data && (
            <Popconfirm title="删除定时计划？" onConfirm={() => remove.mutate()}>
              <Button danger loading={remove.isPending}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Form>

      <div style={{ marginTop: 20 }}>
        {isLoading ? null : data ? (
          <Space direction="vertical" size={4}>
            <Space>
              <Tag color={data.enabled ? 'green' : 'default'}>
                {data.enabled ? '已启用' : '已停用'}
              </Tag>
              <Typography.Text>下次执行：{fmtDateTime(data.next_run_at)}</Typography.Text>
            </Space>
            <Typography.Text type="secondary">
              上次尝试：{fmtDateTime(data.last_run_at)} · 状态：{data.last_status ?? '-'}
              {data.overlap_skipped ? ` · 已跳过 ${data.overlap_skipped} 次重叠` : ''}
            </Typography.Text>
            {data.last_error && (
              <Typography.Text type="danger">上次错误：{data.last_error}</Typography.Text>
            )}
          </Space>
        ) : (
          <Typography.Text type="secondary">还没有定时计划。</Typography.Text>
        )}
      </div>
    </div>
  );
}
