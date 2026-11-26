import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Card, Input, Space, Typography } from 'antd';
import { ArrowLeftOutlined, PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { apiError } from '../api/client';
import { getProjectCases } from '../api/cases';
import { getFeatures } from '../api/features';
import {
  createCaseFlow,
  getCaseFlow,
  runCaseFlow,
  updateCaseFlow,
} from '../api/flows';
import { getProject } from '../api/projects';
import CaseFlowEditor, { type FlowNodeView } from '../components/CaseFlowEditor';
import FeatureTreeSelect from '../components/FeatureTreeSelect';
import { t } from '../i18n';
import { dagLayers } from '../lib/dag';
import type { CaseFlowEdge } from '../api/types';

const CASE_PREFIX = 'case:';

export default function FlowEditor() {
  const { pid = '', fid = '' } = useParams();
  const isNew = fid === 'new';
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nodes, setNodes] = useState<FlowNodeView[]>([]);
  const [edges, setEdges] = useState<CaseFlowEdge[]>([]);

  const { data: project } = useQuery({
    queryKey: ['project', pid],
    queryFn: () => getProject(pid),
    enabled: Boolean(pid),
  });
  const { data: cases = [] } = useQuery({
    queryKey: ['project-cases', pid],
    queryFn: () => getProjectCases(pid),
    enabled: Boolean(pid),
  });
  const { data: features = [] } = useQuery({
    queryKey: ['features', pid],
    queryFn: () => getFeatures(pid),
    enabled: Boolean(pid),
  });
  const { data: detail } = useQuery({
    queryKey: ['case-flow', fid],
    queryFn: () => getCaseFlow(fid),
    enabled: Boolean(fid) && !isNew,
  });

  const featureNames = useMemo(
    () => new Map(features.map((feature) => [feature.id, feature.name])),
    [features],
  );
  const caseMeta = useMemo(() => {
    const map = new Map<string, FlowNodeView>();
    for (const item of cases) {
      map.set(item.id, {
        case_id: item.id,
        name: item.name,
        feature_name: featureNames.get(item.feature_id) ?? '',
        priority: item.priority,
      });
    }
    for (const node of detail?.nodes ?? []) {
      if (!map.has(node.case_id)) {
        map.set(node.case_id, {
          case_id: node.case_id,
          name: node.name,
          feature_name: node.feature_name,
          priority: node.priority,
        });
      }
    }
    return map;
  }, [cases, featureNames, detail]);

  useEffect(() => {
    if (!detail) return;
    setName(detail.name);
    setDescription(detail.description ?? '');
    setNodes(
      detail.nodes.map((node) => ({
        case_id: node.case_id,
        name: node.name,
        feature_name: node.feature_name,
        priority: node.priority,
      })),
    );
    setEdges(detail.edges);
  }, [detail]);

  const layers = dagLayers(
    nodes.map((node) => node.case_id),
    edges,
  );
  const invalid = !name.trim() || nodes.length === 0 || layers === null;

  const save = useMutation({
    mutationFn: async () => {
      const input = {
        name: name.trim(),
        description: description.trim() || null,
        nodes: nodes.map((node) => node.case_id),
        edges,
      };
      return isNew
        ? createCaseFlow(pid, input)
        : updateCaseFlow(fid, input);
    },
    onSuccess: (result) => {
      message.success(t('编排已保存'));
      if (isNew) {
        navigate(`/projects/${pid}/flows/${result.id}`, { replace: true });
      }
    },
    onError: (error) => message.error(apiError(error)),
  });

  const run = useMutation({
    mutationFn: async () => {
      const saved = await save.mutateAsync();
      const result = await runCaseFlow(saved.id);
      return result;
    },
    onSuccess: (result) => {
      const batchId = result.batches[0]?.batch_id;
      if (batchId) {
        message.success(t('编排已开始执行'));
        navigate(`/executions/${batchId}`);
      }
    },
    onError: (error) => message.error(apiError(error)),
  });

  const onPick = (values: string[]) => {
    const ids = values
      .filter((value) => value.startsWith(CASE_PREFIX))
      .map((value) => value.slice(CASE_PREFIX.length));
    const selected = new Set(ids);
    const nextNodes = nodes.filter((node) => selected.has(node.case_id));
    for (const caseId of ids) {
      if (nextNodes.some((node) => node.case_id === caseId)) continue;
      const meta = caseMeta.get(caseId);
      if (meta) nextNodes.push(meta);
    }
    setNodes(nextNodes);
    setEdges((current) =>
      current.filter(
        (edge) =>
          selected.has(edge.case_id) && selected.has(edge.depends_on_case_id),
      ),
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <Space style={{ marginBottom: 12 }}>
        <Link to={`/projects/${pid}`}>
          <ArrowLeftOutlined /> {t('返回系统')}
        </Link>
      </Space>
      <Card
        title={isNew ? t('新建用例编排') : t('编辑用例编排')}
        extra={
          <Space>
            <Button
              icon={<SaveOutlined />}
              loading={save.isPending}
              disabled={invalid}
              onClick={() => save.mutate()}
            >
              {t('保存')}
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={run.isPending}
              disabled={invalid}
              onClick={() => run.mutate()}
            >
              {t('运行编排')}
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%' }}>
            <div style={{ width: 320 }}>
              <Typography.Text type="secondary">{t('名称')}</Typography.Text>
              <Input
                value={name}
                maxLength={128}
                placeholder={t('例如：下单主流程')}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div style={{ width: 520 }}>
              <Typography.Text type="secondary">{t('说明')}</Typography.Text>
              <Input
                value={description}
                placeholder={t('可选')}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </Space>

          <CaseFlowEditor
            nodes={nodes}
            edges={edges}
            onChange={(nextNodes, nextEdges) => {
              setNodes(nextNodes);
              setEdges(nextEdges);
            }}
            picker={
              <FeatureTreeSelect
                teamId={project?.team_id ?? null}
                projectId={pid}
                caseOnly
                value={nodes.map((node) => `${CASE_PREFIX}${node.case_id}`)}
                onChange={onPick}
                placeholder={t('按功能勾选要编排的用例')}
              />
            }
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              '编排内的用例按依赖顺序执行；不属于编排的用例仍按任务原有分片并发执行。前置失败时，依赖它的用例不会再执行。',
            )}
          </Typography.Text>
        </Space>
      </Card>
    </div>
  );
}