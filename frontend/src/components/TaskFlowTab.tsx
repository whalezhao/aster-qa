import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Modal, Select, Space, Tag, Typography } from 'antd';
import { apiError } from '../api/client';
import {
  applyFlowToTask,
  getTaskDependencies,
  listCaseFlows,
  setTaskDependencies,
} from '../api/flows';
import { getTaskCases } from '../api/tasks';
import CaseFlowEditor, { type FlowNodeView } from './CaseFlowEditor';
import { t } from '../i18n';
import type { TaskDependency } from '../api/types';

export default function TaskFlowTab({
  tid,
  projectId,
}: {
  tid: string;
  projectId: string | null;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [flowId, setFlowId] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const [edges, setEdges] = useState<TaskDependency[]>([]);

  const { data: cases = [] } = useQuery({
    queryKey: ['task-cases', tid],
    queryFn: () => getTaskCases(tid),
  });
  const { data: dependencies = [] } = useQuery({
    queryKey: ['task-dependencies', tid],
    queryFn: () => getTaskDependencies(tid),
  });
  const { data: flows = [] } = useQuery({
    queryKey: ['case-flows', projectId],
    queryFn: () => listCaseFlows(projectId as string),
    enabled: Boolean(projectId),
  });

  useEffect(() => setEdges(dependencies), [dependencies]);

  const nodes: FlowNodeView[] = useMemo(
    () =>
      cases.map((item) => ({
        case_id: item.id,
        name: item.name,
        feature_name: item.feature_name,
        priority: item.priority,
      })),
    [cases],
  );
  const nameById = useMemo(
    () => new Map(nodes.map((node) => [node.case_id, node.name])),
    [nodes],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['task-cases', tid] });
    queryClient.invalidateQueries({ queryKey: ['task-dependencies', tid] });
    queryClient.invalidateQueries({ queryKey: ['task', tid] });
  };

  const apply = useMutation({
    mutationFn: () => applyFlowToTask(tid, flowId as string),
    onSuccess: (result) => {
      message.success(
        t('已套用编排：新增 {cases} 个用例、{edges} 条依赖', {
          cases: result.added_cases,
          edges: result.added_edges,
        }),
      );
      refresh();
    },
    onError: (error) => message.error(apiError(error)),
  });

  const save = useMutation({
    mutationFn: () => setTaskDependencies(tid, edges),
    onSuccess: () => {
      message.success(t('依赖已保存'));
      setEditOpen(false);
      refresh();
    },
    onError: (error) => message.error(apiError(error)),
  });

  if (!projectId) {
    return (
      <Alert
        type="info"
        showIcon
        message={t('跨系统任务暂不支持编排：编排按系统定义，依赖也只能在同一个系统内。')}
      />
    );
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 280 }}
          placeholder={t('选择一个可复用的编排')}
          value={flowId}
          options={flows.map((flow) => ({
            value: flow.id,
            label: `${flow.name}（${flow.node_count} 个用例）`,
          }))}
          onChange={setFlowId}
        />
        <Button
          type="primary"
          loading={apply.isPending}
          disabled={!flowId}
          onClick={() => apply.mutate()}
        >
          {t('套用到任务')}
        </Button>
        <Button disabled={cases.length === 0} onClick={() => setEditOpen(true)}>
          {t('编辑依赖')}
        </Button>
      </Space>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t(
          '已编排的用例按依赖顺序执行；未被编排的用例仍按任务原有分片并发执行。前置失败时，依赖它的用例不会再执行。',
        )}
      </Typography.Text>

      {dependencies.length === 0 ? (
        <Alert type="info" showIcon message={t('这个任务还没有编排依赖')} />
      ) : (
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Typography.Text>
            {t('已编排 {cases} 个用例、{edges} 条依赖', {
              cases: new Set(
                dependencies.flatMap((edge) => [
                  edge.case_id,
                  edge.depends_on_case_id,
                ]),
              ).size,
              edges: dependencies.length,
            })}
          </Typography.Text>
          <Space wrap>
            {dependencies.map((edge) => (
              <Tag key={`${edge.case_id}-${edge.depends_on_case_id}`}>
                {nameById.get(edge.case_id) ?? edge.case_id} ←{' '}
                {nameById.get(edge.depends_on_case_id) ?? edge.depends_on_case_id}
              </Tag>
            ))}
          </Space>
        </Space>
      )}

      <Modal
        open={editOpen}
        title={t('编辑任务依赖')}
        width={1000}
        onCancel={() => setEditOpen(false)}
        onOk={() => save.mutate()}
        confirmLoading={save.isPending}
      >
        <CaseFlowEditor
          fixedNodes
          nodes={nodes}
          edges={edges}
          onChange={(_nodes, nextEdges) => setEdges(nextEdges)}
        />
      </Modal>
    </Space>
  );
}