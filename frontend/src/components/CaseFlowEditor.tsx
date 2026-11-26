import { useState } from 'react';
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, SettingOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { dagLayers } from '../lib/dag';
import type { CaseFlowEdge, FlowCondition, FlowConditionOp } from '../api/types';

export interface FlowNodeView {
  case_id: string;
  name: string;
  feature_name?: string | null;
  priority?: string | null;
  x?: number | null;
  y?: number | null;
  condition?: FlowCondition | null;
  repeat_count?: number;
}

const OP_LABELS: Record<FlowConditionOp, string> = {
  eq: '=',
  ne: '≠',
  contains: '包含',
  gt: '>',
  lt: '<',
};

export default function CaseFlowEditor({
  nodes,
  edges,
  onChange,
  picker,
  disabled = false,
  fixedNodes = false,
}: {
  nodes: FlowNodeView[];
  edges: CaseFlowEdge[];
  onChange: (nodes: FlowNodeView[], edges: CaseFlowEdge[]) => void;
  picker?: React.ReactNode;
  disabled?: boolean;
  /** 任务内编辑依赖时用例集合固定，只改边 */
  fixedNodes?: boolean;
}) {
  const [editing, setEditing] = useState<FlowNodeView | null>(null);
  const [variable, setVariable] = useState('');
  const [op, setOp] = useState<FlowConditionOp>('eq');
  const [value, setValue] = useState('');
  const [repeat, setRepeat] = useState(1);

  const openSettings = (node: FlowNodeView) => {
    setEditing(node);
    setVariable(node.condition?.variable ?? '');
    setOp(node.condition?.op ?? 'eq');
    setValue(node.condition ? String(node.condition.value) : '');
    setRepeat(node.repeat_count ?? 1);
  };

  const saveSettings = () => {
    if (!editing) return;
    const condition = variable.trim()
      ? { variable: variable.trim(), op, value }
      : null;
    onChange(
      nodes.map((node) =>
        node.case_id === editing.case_id
          ? { ...node, condition, repeat_count: Math.max(1, repeat) }
          : node,
      ),
      edges,
    );
    setEditing(null);
  };

  const layers = dagLayers(
    nodes.map((node) => node.case_id),
    edges,
  );

  const setDependencies = (caseId: string, dependencies: string[]) => {
    const allowed = new Set(nodes.map((node) => node.case_id));
    const next = edges.filter((edge) => edge.case_id !== caseId);
    for (const dependsOn of dependencies) {
      if (dependsOn !== caseId && allowed.has(dependsOn)) {
        next.push({ case_id: caseId, depends_on_case_id: dependsOn });
      }
    }
    onChange(nodes, next);
  };

  const removeNode = (caseId: string) => {
    onChange(
      nodes.filter((node) => node.case_id !== caseId),
      edges.filter(
        (edge) =>
          edge.case_id !== caseId && edge.depends_on_case_id !== caseId,
      ),
    );
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {picker}
      <Table
        size="small"
        rowKey="case_id"
        pagination={false}
        dataSource={nodes}
        locale={{ emptyText: t('还没有用例') }}
        columns={[
          {
            title: t('用例'),
            dataIndex: 'name',
            render: (_value, node) => (
              <Space size={6}>
                <span>{node.name}</span>
                {node.priority && <Tag>{node.priority}</Tag>}
              </Space>
            ),
          },
          {
            title: t('功能'),
            dataIndex: 'feature_name',
            width: 180,
            render: (value: string | null | undefined) => value || '-',
          },
          ...(fixedNodes
            ? []
            : [
                {
                  title: t('条件/循环'),
                  width: 250,
                  render: (_value: unknown, node: FlowNodeView) => (
                    <Space size={4} wrap>
                      {node.condition ? (
                        <Tag color="purple">
                          {node.condition.variable}{' '}
                          {OP_LABELS[node.condition.op]}{' '}
                          {String(node.condition.value)}
                        </Tag>
                      ) : (
                        <Typography.Text type="secondary">-</Typography.Text>
                      )}
                      {(node.repeat_count ?? 1) > 1 && (
                        <Tag color="geekblue">×{node.repeat_count}</Tag>
                      )}
                      <Button
                        size="small"
                        type="text"
                        icon={<SettingOutlined />}
                        onClick={() => openSettings(node)}
                      />
                    </Space>
                  ),
                },
              ]),
          {
            title: t('前置用例'),
            width: 360,
            render: (_value, node) => (
              <Select
                mode="multiple"
                allowClear
                style={{ width: '100%' }}
                placeholder={t('不选表示没有前置')}
                disabled={disabled}
                value={edges
                  .filter((edge) => edge.case_id === node.case_id)
                  .map((edge) => edge.depends_on_case_id)}
                options={nodes
                  .filter((item) => item.case_id !== node.case_id)
                  .map((item) => ({
                    value: item.case_id,
                    label: item.name,
                  }))}
                onChange={(values) => setDependencies(node.case_id, values)}
              />
            ),
          },
          ...(fixedNodes
            ? []
            : [
                {
                  title: t('操作'),
                  width: 90,
                  render: (_value: unknown, node: FlowNodeView) => (
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={disabled}
                      onClick={() => removeNode(node.case_id)}
                    />
                  ),
                },
              ]),
        ]}
      />

      <Modal
        open={Boolean(editing)}
        title={t('条件与循环')}
        onCancel={() => setEditing(null)}
        onOk={saveSettings}
        okText={t('保存')}
        cancelText={t('取消')}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">{t('条件变量')}</Typography.Text>
            <Input
              value={variable}
              placeholder="ORDER_STATUS"
              onChange={(event) => setVariable(event.target.value)}
            />
          </div>
          <Space>
            <Select
              value={op}
              style={{ width: 110 }}
              onChange={(next) => setOp(next)}
              options={(
                ['eq', 'ne', 'contains', 'gt', 'lt'] as FlowConditionOp[]
              ).map((item) => ({
                value: item,
                label: OP_LABELS[item],
              }))}
            />
            <Input
              value={value}
              style={{ width: 240 }}
              placeholder={t('期望值')}
              onChange={(event) => setValue(event.target.value)}
            />
          </Space>
          <div>
            <Typography.Text type="secondary">
              {t('重复次数（固定循环）')}
            </Typography.Text>
            <InputNumber
              min={1}
              max={20}
              value={repeat}
              onChange={(next) => setRepeat(Number(next ?? 1))}
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              '变量来自前置节点 capture 的输出；条件不满足时该节点及其下游会跳过。重复次数大于 1 时按顺序执行多轮。',
            )}
          </Typography.Text>
          <Button
            onClick={() => {
              setVariable('');
              setValue('');
              setRepeat(1);
            }}
          >
            {t('清除条件')}
          </Button>
        </Space>
      </Modal>

      {layers === null ? (
        <Alert
          type="error"
          showIcon
          message={t('编排存在循环依赖，请调整前置用例')}
        />
      ) : (
        layers.length > 0 && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('执行层预览：同一层的用例没有依赖关系，可以并行执行')}
            </Typography.Text>
            <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 6 }}>
              {layers.map((layer, index) => (
                <Space key={index} wrap>
                  <Tag color="blue">{t('第 {n} 层', { n: index })}</Tag>
                  {layer.map((caseId) => (
                    <Tag key={caseId}>
                      {nodes.find((node) => node.case_id === caseId)?.name ?? caseId}
                    </Tag>
                  ))}
                </Space>
              ))}
            </Space>
          </div>
        )
      )}
    </Space>
  );
}