import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, List, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { useQueries, useQuery } from '@tanstack/react-query';
import { preflightTask } from '../api/preflight';
import { getProjectEnvironments } from '../api/environments';
import { getTaskFeatures } from '../api/tasks';
import type { PreflightCheck } from '../api/types';
import { t } from '../i18n';

interface Props {
  open: boolean;
  taskId: string;
  taskName?: string;
  /** 任务配置的环境，打开时默认勾选 */
  defaultEnvironmentName?: string;
  onCancel: () => void;
  onRun: (environmentNames: string[]) => void;
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
            {item.severity === 'ok' ? t('通过') : item.severity === 'warning' ? t('注意') : t('阻断')}
          </Tag>
          {item.project_name && <Typography.Text strong>{item.project_name}</Typography.Text>}
          <Typography.Text>{t(item.message)}</Typography.Text>
        </Space>
        {!item.ok && item.overridable && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('这一项可以继续执行，但失败风险更高。')}
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
  defaultEnvironmentName,
  onCancel,
  onRun,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected([(defaultEnvironmentName || '').trim() || '默认']);
  }, [open, taskId, defaultEnvironmentName]);

  // 可选环境 = 任务所有项目下同名的环境（跨项目任务要求每个项目都有）
  const { data: features = [] } = useQuery({
    queryKey: ['task-features', taskId],
    queryFn: () => getTaskFeatures(taskId),
    enabled: open && Boolean(taskId),
  });
  const projectIds = useMemo(
    () => [...new Set(features.map((feature) => feature.project_id))].sort(),
    [features],
  );
  const { data: environmentOptions } = useQuery({
    queryKey: ['task-env-options', taskId, projectIds],
    queryFn: async () => {
      const lists = await Promise.all(projectIds.map((id) => getProjectEnvironments(id)));
      const names = (lists[0] ?? [])
        .map((env) => env.name)
        .filter((name) => lists.every((list) => list.some((env) => env.name === name)));
      return [...new Set(['默认', ...names])];
    },
    enabled: open && Boolean(taskId) && projectIds.length > 0,
  });
  const options = (environmentOptions ?? ['默认']).map((name) => ({
    value: name,
    label: name === '默认' ? t('默认') : name,
  }));

  const queries = useQueries({
    queries: selected.map((name) => ({
      queryKey: ['preflight', taskId, name],
      queryFn: () => preflightTask(taskId, name),
      enabled: open && Boolean(taskId),
      staleTime: 0,
    })),
  });

  const loading = queries.some((q) => q.isLoading);
  const error = queries.find((q) => q.isError)?.error;
  const blocking = selected.length === 0 || queries.some((q) => q.data && !q.data.can_run);

  return (
    <Modal
      open={open}
      title={taskName ? t('执行前检查 · {name}', { name: taskName }) : t('执行前检查')}
      width={680}
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel}>{t('取消')}</Button>
          <Button
            type="primary"
            disabled={!selected.length || loading || Boolean(error) || blocking}
            onClick={() => onRun(selected)}
          >
            {t('开始执行')}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Typography.Text strong>{t('执行环境')}</Typography.Text>
          <Select
            mode="multiple"
            style={{ minWidth: 260 }}
            placeholder={t('选择一个或多个环境')}
            value={selected}
            onChange={setSelected}
            options={options}
          />
          <Typography.Text type="secondary">
            {t('勾选多个环境时，每个环境各生成一条执行记录。')}
          </Typography.Text>
        </Space>

        {loading && (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Spin />
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">{t('正在检查模型、环境和执行器…')}</Typography.Text>
            </div>
          </div>
        )}
        {error && (
          <Alert type="error" showIcon message={t('预检失败')} description={String(error)} />
        )}
        {!loading &&
          queries.map((query, index) =>
            query.data ? (
              <div key={selected[index]}>
                {selected.length > 1 && (
                  <Typography.Text strong>{t('环境「{name}」', { name: t(selected[index]) })}</Typography.Text>
                )}
                <Alert
                  style={{ marginTop: 6 }}
                  type={query.data.can_run ? 'success' : 'error'}
                  showIcon
                  message={
                    query.data.can_run ? t('检查通过，可以执行') : t('有阻断项，暂时不能执行')
                  }
                />
                <List
                  size="small"
                  dataSource={query.data.checks}
                  renderItem={(item) => <CheckRow item={item} />}
                />
              </div>
            ) : null,
          )}
      </Space>
    </Modal>
  );
}
