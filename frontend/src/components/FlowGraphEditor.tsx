import { useId, useMemo, useState } from 'react';
import { Button, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, LinkOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { dagLayers } from '../lib/dag';
import type { FlowNodeView } from './CaseFlowEditor';
import type { CaseFlowEdge } from '../api/types';

const NODE_W = 200;
const NODE_H = 78;
const GAP_X = 100;
const GAP_Y = 46;

interface DragState {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

function computedPositions(
  nodes: FlowNodeView[],
  edges: CaseFlowEdge[],
): Map<string, { x: number; y: number }> {
  const layers = dagLayers(
    nodes.map((node) => node.case_id),
    edges,
  ) ?? [nodes.map((node) => node.case_id)];
  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, layerIndex) => {
    layer.forEach((caseId, rowIndex) => {
      positions.set(caseId, {
        x: 40 + layerIndex * (NODE_W + GAP_X),
        y: 40 + rowIndex * (NODE_H + GAP_Y),
      });
    });
  });
  return positions;
}

export default function FlowGraphEditor({
  nodes,
  edges,
  onChange,
  disabled = false,
}: {
  nodes: FlowNodeView[];
  edges: CaseFlowEdge[];
  onChange: (nodes: FlowNodeView[], edges: CaseFlowEdge[]) => void;
  disabled?: boolean;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const markerId = useId().replace(/:/g, '');

  const positions = useMemo(
    () => computedPositions(nodes, edges),
    [nodes, edges],
  );
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        x: node.x ?? positions.get(node.case_id)?.x ?? 40,
        y: node.y ?? positions.get(node.case_id)?.y ?? 40,
      })),
    [nodes, positions],
  );
  const byId = useMemo(
    () => new Map(displayNodes.map((node) => [node.case_id, node])),
    [displayNodes],
  );

  const width = Math.max(
    760,
    ...displayNodes.map((node) => (node.x ?? 0) + NODE_W + 80),
  );
  const height = Math.max(
    360,
    ...displayNodes.map((node) => (node.y ?? 0) + NODE_H + 80),
  );

  const moveNode = (caseId: string, x: number, y: number) => {
    onChange(
      nodes.map((node) => (node.case_id === caseId ? { ...node, x, y } : node)),
      edges,
    );
  };

  const autoLayout = () => {
    const layout = computedPositions(nodes, edges);
    onChange(
      nodes.map((node) => ({
        ...node,
        x: layout.get(node.case_id)?.x ?? node.x ?? 40,
        y: layout.get(node.case_id)?.y ?? node.y ?? 40,
      })),
      edges,
    );
  };

  const connect = (targetId: string) => {
    if (!connectFrom || connectFrom === targetId) {
      setConnectFrom(null);
      return;
    }
    const exists = edges.some(
      (edge) =>
        edge.case_id === targetId && edge.depends_on_case_id === connectFrom,
    );
    if (!exists) {
      onChange(nodes, [
        ...edges,
        { case_id: targetId, depends_on_case_id: connectFrom },
      ]);
    }
    setConnectFrom(null);
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
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space wrap>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          disabled={disabled}
          onClick={autoLayout}
        >
          {t('自动布局')}
        </Button>
        {connectFrom ? (
          <Typography.Text type="warning">
            {t('已选择起点，点击目标节点建立依赖（目标依赖起点）')}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('拖动节点调整位置；点「连线」再点另一个节点，后点的是依赖方')}
          </Typography.Text>
        )}
      </Space>
      <div
        style={{
          position: 'relative',
          width: '100%',
          minHeight: 360,
          overflow: 'auto',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          background:
            'radial-gradient(circle, #f0f0f0 1px, transparent 1px) 0 0 / 16px 16px',
        }}
        onClick={() => setConnectFrom(null)}
      >
        <div style={{ position: 'relative', width, height }}>
          <svg
            width={width}
            height={height}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <defs>
              <marker
                id={markerId}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="#8c8c8c" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const source = byId.get(edge.depends_on_case_id);
              const target = byId.get(edge.case_id);
              if (!source || !target) return null;
              const x1 = (source.x ?? 0) + NODE_W;
              const y1 = (source.y ?? 0) + NODE_H / 2;
              const x2 = target.x ?? 0;
              const y2 = (target.y ?? 0) + NODE_H / 2;
              const path = `M ${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}`;
              return (
                <g
                  key={`${edge.case_id}-${edge.depends_on_case_id}`}
                  style={{ pointerEvents: 'auto' }}
                >
                  <path
                    d={path}
                    stroke="transparent"
                    strokeWidth={14}
                    fill="none"
                    style={{ cursor: disabled ? 'default' : 'pointer' }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (disabled) return;
                      onChange(
                        nodes,
                        edges.filter(
                          (item) =>
                            !(
                              item.case_id === edge.case_id &&
                              item.depends_on_case_id ===
                                edge.depends_on_case_id
                            ),
                        ),
                      );
                    }}
                  >
                    <title>{t('点击删除这条依赖')}</title>
                  </path>
                  <path
                    d={path}
                    stroke="#8c8c8c"
                    strokeWidth={1.5}
                    fill="none"
                    markerEnd={`url(#${markerId})`}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              );
            })}
          </svg>

          {displayNodes.map((node) => (
            <div
              key={node.case_id}
              style={{
                position: 'absolute',
                left: node.x ?? 0,
                top: node.y ?? 0,
                width: NODE_W,
                minHeight: NODE_H,
                padding: '8px 10px',
                borderRadius: 8,
                border:
                  connectFrom === node.case_id
                    ? '1px solid #1677ff'
                    : '1px solid #d9d9d9',
                background: '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                cursor: disabled ? 'default' : 'grab',
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (connectFrom) connect(node.case_id);
              }}
            >
              <div
                onPointerDown={(event) => {
                  if (disabled) return;
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDrag({
                    id: node.case_id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: node.x ?? 0,
                    originY: node.y ?? 0,
                  });
                }}
                onPointerMove={(event) => {
                  if (!drag || drag.id !== node.case_id) return;
                  moveNode(
                    node.case_id,
                    Math.max(0, drag.originX + event.clientX - drag.startX),
                    Math.max(0, drag.originY + event.clientY - drag.startY),
                  );
                }}
                onPointerUp={(event) => {
                  if (drag?.id === node.case_id) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    setDrag(null);
                  }
                }}
                style={{
                  cursor: disabled ? 'default' : 'grab',
                  userSelect: 'none',
                  touchAction: 'none',
                }}
              >
                <Space size={6} wrap>
                  <span style={{ fontWeight: 500 }}>{node.name}</span>
                  {node.priority && <Tag>{node.priority}</Tag>}
                  {node.condition && <Tag color="purple">条件</Tag>}
                  {(node.repeat_count ?? 1) > 1 && (
                    <Tag color="geekblue">×{node.repeat_count}</Tag>
                  )}
                </Space>
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 12 }}
                >
                  {node.feature_name || '-'}
                </Typography.Text>
              </div>
              <Space size={4} style={{ marginTop: 6 }}>
                <Button
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    setConnectFrom(node.case_id);
                  }}
                >
                  {t('连线')}
                </Button>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeNode(node.case_id);
                  }}
                />
              </Space>
            </div>
          ))}
        </div>
      </div>
    </Space>
  );
}