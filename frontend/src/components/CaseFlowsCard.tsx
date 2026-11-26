import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Modal, Popconfirm, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiError } from '../api/client';
import { deleteCaseFlow, listCaseFlows, runCaseFlow } from '../api/flows';
import { getProjectEnvironments } from '../api/environments';
import { t } from '../i18n';
import { fmtDateTime } from '../lib/format';
import type { CaseFlowSummary } from '../api/types';

export default function CaseFlowsCard({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [runTarget, setRunTarget] = useState<CaseFlowSummary | null>(null);
  const [runEnvironment, setRunEnvironment] = useState<string | undefined>();

  const { data: flows = [], isLoading } = useQuery({
    queryKey: ['case-flows', projectId],
    queryFn: () => listCaseFlows(projectId),
    enabled: Boolean(projectId),
  });
  const { data: environments = [] } = useQuery({
    queryKey: ['project-environments', projectId],
    queryFn: () => getProjectEnvironments(projectId),
    enabled: Boolean(projectId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['case-flows', projectId] });

  const remove = useMutation({
    mutationFn: (flowId: string) => deleteCaseFlow(flowId),
    onSuccess: () => {
      message.success(t('编排已删除'));
      refresh();
    },
    onError: (error) => message.error(apiError(error)),
  });

  const run = useMutation({
    mutationFn: ({ flowId, environment }: { flowId: string; environment?: string }) =>
      runCaseFlow(flowId, environment ? [environment] : []),
    onSuccess: (result) => {
      const batchId = result.batches[0]?.batch_id;
      if (batchId) {
        setRunTarget(null);
        message.success(t('编排已开始执行'));
        navigate(`/executions/${batchId}`);
      }
    },
    onError: (error) => message.error(apiError(error)),
  });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate(`/projects/${projectId}/flows/new`)}
        >
          {t('新建编排')}
        </Button>
        <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
          {t('编排是可复用的模板：可以跨功能选用例并设置依赖，再套用到任务或直接运行。')}
        </span>
      </Space>
      <Table<CaseFlowSummary>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={flows}
        pagination={false}
        columns={[
          {
            title: t('名称'),
            dataIndex: 'name',
            render: (value: string, row) => (
              <Link to={`/projects/${projectId}/flows/${row.id}`}>{value}</Link>
            ),
          },
          { title: t('说明'), dataIndex: 'description', render: (value: string | null) => value || '-' },
          { title: t('用例数'), dataIndex: 'node_count', width: 90 },
          { title: t('依赖数'), dataIndex: 'edge_count', width: 90 },
          {
            title: t('更新时间'),
            dataIndex: 'updated_at',
            width: 170,
            render: (value: string) => fmtDateTime(value),
          },
          {
            title: t('操作'),
            width: 240,
            render: (_value, row) => (
              <Space>
                <Button size="small" onClick={() => navigate(`/projects/${projectId}/flows/${row.id}`)}>
                  {t('编辑')}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  loading={run.isPending}
                  onClick={() => {
                    setRunTarget(row);
                    setRunEnvironment(undefined);
                  }}
                >
                  {t('运行')}
                </Button>
                <Popconfirm
                  title={t('删除这个编排？已套用的任务不受影响')}
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

      <Modal
        open={Boolean(runTarget)}
        title={t('运行编排')}
        onCancel={() => setRunTarget(null)}
        onOk={() =>
          runTarget &&
          run.mutate({ flowId: runTarget.id, environment: runEnvironment })
        }
        confirmLoading={run.isPending}
        okText={t('开始执行')}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text>{runTarget?.name}</Typography.Text>
          <Select
            allowClear
            style={{ width: '100%' }}
            placeholder={t('默认环境')}
            value={runEnvironment}
            onChange={setRunEnvironment}
            options={environments.map((environment) => ({
              value: environment.name,
              label: environment.name,
            }))}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('不选环境时使用「默认」环境。')}
          </Typography.Text>
        </Space>
      </Modal>
    </Space>
  );
}