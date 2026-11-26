import { Alert, Button, Select, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { dagLayers } from '../lib/dag';
import type { CaseFlowEdge } from '../api/types';

export interface FlowNodeView {
  case_id: string;
  name: string;
  feature_name?: string | null;
  priority?: string | null;
}

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