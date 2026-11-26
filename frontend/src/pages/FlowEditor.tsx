import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Drawer,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { apiError } from '../api/client';
import { getProjectCases } from '../api/cases';
import { getFeatures } from '../api/features';
import {
  createCaseFlow,
  getCaseFlow,
  getCaseFlowVersions,
  rollbackCaseFlow,
  runCaseFlow,
  updateCaseFlow,
} from '../api/flows';
import { getProject } from '../api/projects';
import CaseFlowEditor, { type FlowNodeView } from '../components/CaseFlowEditor';
import FlowGraphEditor from '../components/FlowGraphEditor';
import FeatureTreeSelect from '../components/FeatureTreeSelect';
import { t } from '../i18n';
import { dagLayers } from '../lib/dag';
import { fmtDateTime } from '../lib/format';
import type { CaseFlowEdge, CaseFlowVersionSummary } from '../api/types';

const CASE_PREFIX = 'case:';

const SOURCE_LABELS: Record<string, string> = {
  create: '创建',
  manual: '保存',
  rollback: '回滚',
};

export default function FlowEditor() {
  const { pid = '', fid = '' } = useParams();
  const isNew = fid === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nodes, setNodes] = useState<FlowNodeView[]>([]);
  const [edges, setEdges] = useState<CaseFlowEdge[]>([]);
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [versionOpen, setVersionOpen] = useState(false);

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
  const versionsQuery = useQuery({
    queryKey: ['case-flow-versions', fid],
    queryFn: () => getCaseFlowVersions(fid),
    enabled: Boolean(fid) && !isNew && versionOpen,
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
        condition: null,
        repeat_count: 1,
      });
    }
    for (const node of detail?.nodes ?? []) {
      if (!map.has(node.case_id)) {
        map.set(node.case_id, {
          case_id: node.case_id,
          name: node.name,
          feature_name: node.feature_name,
          priority: node.priority,
          x: node.x,
          y: node.y,
          condition: node.condition,
          repeat_count: node.repeat_count,
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
        x: node.x,
        y: node.y,
        condition: node.condition,
        repeat_count: node.repeat_count,
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
        nodes: nodes.map((node) => ({
          case_id: node.case_id,
          x: node.x ?? null,
          y: node.y ?? null,
          condition: node.condition ?? null,
          repeat_count: node.repeat_count ?? 1,
        })),
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
      } else {
        queryClient.invalidateQueries({ queryKey: ['case-flow', fid] });
        queryClient.invalidateQueries({ queryKey: ['case-flow-versions', fid] });
        queryClient.invalidateQueries({ queryKey: ['case-flows', pid] });
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

  const rollback = useMutation({
    mutationFn: (versionNo: number) => rollbackCaseFlow(fid, versionNo),
    onSuccess: () => {
      message.success(t('已回滚编排版本'));
      queryClient.invalidateQueries({ queryKey: ['case-flow', fid] });
      queryClient.invalidateQueries({ queryKey: ['case-flow-versions', fid] });
      queryClient.invalidateQueries({ queryKey: ['case-flows', pid] });
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

  const sourceLabel = (version: CaseFlowVersionSummary) =>
    t(SOURCE_LABELS[version.change_source] ?? version.change_source);

  return (
    <div style={{ padding: 20 }}>
      <Space style={{ marginBottom: 12 }}>
        <Link to={`/projects/${pid}`}>
          <ArrowLeftOutlined /> {t('返回系统')}
        </Link>
      </Space>
      <Card
        title={
          <Space>
            <span>{isNew ? t('新建用例编排') : t('编辑用例编排')}</span>
            {!isNew && (
              <Tag color="blue">v{detail?.current_version_no ?? 1}</Tag>
            )}
          </Space>
        }
        extra={
          <Space>
            {!isNew && (
              <Button
                icon={<HistoryOutlined />}
                onClick={() => setVersionOpen(true)}
              >
                {t('版本历史')}
              </Button>
            )}
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

          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <FeatureTreeSelect
              teamId={project?.team_id ?? null}
              projectId={pid}
              caseOnly
              value={nodes.map((node) => `${CASE_PREFIX}${node.case_id}`)}
              onChange={onPick}
              placeholder={t('按功能勾选要编排的用例')}
              style={{ maxWidth: 760 }}
            />
            <Segmented
              value={view}
              onChange={(value) => setView(value as 'graph' | 'table')}
              options={[
                { value: 'graph', label: t('图编辑') },
                { value: 'table', label: t('表格') },
              ]}
            />
          </Space>

          {view === 'graph' ? (
            <FlowGraphEditor
              nodes={nodes}
              edges={edges}
              onChange={(nextNodes, nextEdges) => {
                setNodes(nextNodes);
                setEdges(nextEdges);
              }}
            />
          ) : (
            <CaseFlowEditor
              nodes={nodes}
              edges={edges}
              onChange={(nextNodes, nextEdges) => {
                setNodes(nextNodes);
                setEdges(nextEdges);
              }}
            />
          )}

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              '编排内的用例按依赖顺序执行；不属于编排的用例仍按任务原有分片并发执行。前置失败时，依赖它的用例不会再执行。',
            )}
          </Typography.Text>
        </Space>
      </Card>

      <Drawer
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title={t('版本历史')}
        width={520}
      >
        {versionsQuery.isLoading ? (
          <Typography.Text type="secondary">{t('加载中…')}</Typography.Text>
        ) : (versionsQuery.data ?? []).length === 0 ? (
          <Typography.Text type="secondary">{t('还没有版本')}</Typography.Text>
        ) : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {(versionsQuery.data ?? []).map((version) => (
              <div
                key={version.version_no}
                style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 10 }}
              >
                <Space wrap>
                  <Tag
                    color={
                      version.version_no === detail?.current_version_no
                        ? 'blue'
                        : 'default'
                    }
                  >
                    v{version.version_no}
                  </Tag>
                  <span>{version.name}</span>
                  <Tag>{sourceLabel(version)}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtDateTime(version.created_at)}
                  </Typography.Text>
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('{cases} 个用例 · {edges} 条依赖', {
                      cases: version.node_count,
                      edges: version.edge_count,
                    })}
                    {version.change_note ? ` · ${version.change_note}` : ''}
                  </Typography.Text>
                </div>
                {version.version_no !== detail?.current_version_no && (
                  <Popconfirm
                    title={t('回滚到这个版本？')}
                    description={t('回滚会生成一个新版本，不会删除历史。')}
                    onConfirm={() => rollback.mutate(version.version_no)}
                  >
                    <Button size="small" loading={rollback.isPending}>
                      {t('回滚')}
                    </Button>
                  </Popconfirm>
                )}
              </div>
            ))}
          </Space>
        )}
      </Drawer>
    </div>
  );
}