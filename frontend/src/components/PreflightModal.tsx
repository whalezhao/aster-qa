import { Alert, Button, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { preflightTask } from '../api/preflight';
import type { PreflightCheck } from '../api/types';

interface Props {
  open: boolean;
  taskId: string;
  taskName?: string;
  onCancel: () => void;
  onRun: () => void;
}

const severityColor: Record<string, string> = {
  ok: 'success',
  warning: 'warning',
  error: 'error',
  info: 'processing',
};

function CheckRow({ item }: { item: PreflightCheck }) {
  return (
    <List.Item>
      <Space direction="vertical" size={0} style={{ width: '100%' }}>
        <Space wrap>
          <Tag color={severityColor[item.severity] ?? 'default'}>
            {item.severity === 'ok' ? '通过' : item.severity === 'warning' ? '注意' : '阻断'}
          </Tag>
          {item.project_name && <Typography.Text strong>{item.project_name}</Typography.Text>}
          <Typography.Text>{item.message}</Typography.Text>
        </Space>
        {!item.ok && item.overridable && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            这一项可以继续执行，但失败风险更高。
          </Typography.Text>
        )}
      </Space>
    </List.Item>
  );
}

/** 执行前预检：一次性看清模型、环境、额度、被测地址和执行器状态。 */
export default function PreflightModal({
  open,
  taskId,
  taskName,
  onCancel,
  onRun,
}: Props) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['preflight', taskId],
    queryFn: () => preflightTask(taskId),
    enabled: open && Boolean(taskId),
    staleTime: 0,
  });

  const blocking = data ? !data.can_run : false;

  return (
    <Modal
      open={open}
      title={`执行前检查${taskName ? ` · ${taskName}` : ''}`}
      width={680}
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" disabled={!data || blocking} onClick={onRun}>
            开始执行
          </Button>
        </Space>
      }
    >
      {isLoading && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Spin />
          <div style={{ marginTop: 12 }}>
            <Typography.Text type="secondary">正在检查模型、环境和执行器…</Typography.Text>
          </div>
        </div>
      )}
      {isError && (
        <Alert type="error" showIcon message="预检失败" description={String(error)} />
      )}
      {data && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type={blocking ? 'error' : 'success'}
            showIcon
            message={
              blocking
                ? '有阻断项，暂时不能执行'
                : `检查通过，将使用环境「${data.environment_name}」执行`
            }
          />
          <List
            size="small"
            dataSource={data.checks}
            renderItem={(item) => <CheckRow item={item} />}
          />
        </Space>
      )}
    </Modal>
  );
}
