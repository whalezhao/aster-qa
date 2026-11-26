import { useEffect } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { App, Tag, TreeSelect, Typography } from 'antd';
import { getProjectCases } from '../api/cases';
import { getFeatures } from '../api/features';
import { getProjects } from '../api/projects';
import { t } from '../i18n';
import { buildFeatureTree, CASE_VALUE_PREFIX, type FeatureNode } from '../lib/featureTree';
import type { CaseOption } from '../api/types';

const PRIORITY_COLOR: Record<string, string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'blue',
  P3: 'default',
};

interface FeatureOption {
  title: React.ReactNode;
  value: string;
  disabled?: boolean;
  selectable?: boolean;
  checkable?: boolean;
  isLeaf?: boolean;
  /** 自定义搜索用：标题是 ReactNode，不能再靠 treeNodeFilterProp 取文本 */
  searchText: string;
  children?: FeatureOption[];
}

/**
 * 「系统 → 功能树 → 用例」多选。新建任务和新建回归都用它。
 *
 * 没配好大模型的系统，其下功能和用例直接不可选 —— 选了也跑不了，不如一开始就拦住。
 * 判定口径以后端的 has_model_config 为准。
 *
 * 任务上选了系统（projectId）时，树只展示该系统；若之前已勾了别的系统的功能/用例，
 * 会被移除并弹窗告知，避免出现「选了 A 系统却带着 B 系统用例」的任务。
 */
export default function FeatureTreeSelect({
  teamId,
  projectId,
  value,
  onChange,
  placeholder = '按系统选择功能或用例',
  style,
  disabled = false,
  caseOnly = false,
}: {
  teamId: string | null;
  projectId?: string | null;
  value?: string[];
  onChange?: (ids: string[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  /** 只允许勾选用例（编排场景）；功能节点只作为分组展示 */
  caseOnly?: boolean;
}) {
  const { modal } = App.useApp();
  // 编辑态只是展示已快照的选择，不做过滤和清理
  const scoped = Boolean(projectId) && !disabled;

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => getProjects(teamId as string),
    enabled: Boolean(teamId),
  });

  const visibleProjects = scoped
    ? projects.filter((p) => p.id === projectId)
    : projects;

  const featureQueries = useQueries({
    queries: visibleProjects.map((p) => ({
      queryKey: ['features', p.id, 'all'],
      queryFn: () => getFeatures(p.id),
      enabled: Boolean(teamId),
    })),
  });

  const caseQueries = useQueries({
    queries: visibleProjects.map((p) => ({
      queryKey: ['project-cases', p.id],
      queryFn: () => getProjectCases(p.id),
      enabled: Boolean(teamId),
    })),
  });

  // 所选系统的选择范围（功能和用例 id）；用它判断已勾选的是否属于该系统
  const scopedFeatures = scoped ? featureQueries[0]?.data : undefined;
  const scopedCases = scoped ? caseQueries[0]?.data : undefined;
  const scopedLoading = scoped
    ? Boolean(featureQueries[0]?.isLoading || caseQueries[0]?.isLoading)
    : false;

  useEffect(() => {
    if (!scoped || !value?.length) return;
    // 还没加载完就清理，会把全部已选误判成「别的系统」
    if (scopedLoading || scopedFeatures === undefined || scopedCases === undefined) return;
    const allowed = new Set<string>([
      ...scopedFeatures.map((f) => f.id),
      ...scopedCases.map((c) => `${CASE_VALUE_PREFIX}${c.id}`),
    ]);
    const kept = value.filter((id) => allowed.has(id));
    if (kept.length === value.length) return;
    onChange?.(kept);
    modal.warning({
      title: t('已切换系统'),
      content: t(
        '你之前选了其它系统的 {count} 个功能或用例，已从选择中移除。当前只保留「{name}」下的内容。',
        { count: value.length - kept.length, name: projects.find((p) => p.id === projectId)?.name ?? '' },
      ),
      okText: t('知道了'),
    });
  }, [
    scoped,
    projectId,
    value,
    scopedLoading,
    scopedFeatures,
    scopedCases,
    projects,
    onChange,
    modal,
  ]);

  const casesByFeature = (cases: CaseOption[]) => {
    const map = new Map<string, CaseOption[]>();
    for (const c of cases) {
      const list = map.get(c.feature_id);
      if (list) list.push(c);
      else map.set(c.feature_id, [c]);
    }
    return map;
  };

  const toOptions = (
    nodes: FeatureNode[],
    ready: boolean,
    caseMap: Map<string, CaseOption[]>,
  ): FeatureOption[] =>
    nodes.map((f) => {
      const children: FeatureOption[] = [
        ...(f.children ? toOptions(f.children, ready, caseMap) : []),
        ...(caseMap.get(f.id) ?? []).map((c) => ({
          title: (
            <span>
              {c.name}
              {c.priority && (
                <Tag
                  color={PRIORITY_COLOR[c.priority]}
                  style={{ marginInlineStart: 4 }}
                >
                  {c.priority}
                </Tag>
              )}
            </span>
          ),
          value: `${CASE_VALUE_PREFIX}${c.id}`,
          disabled: !ready,
          isLeaf: true,
          searchText: [c.name, c.priority ?? ''].join(' '),
        })),
      ];
      const stage = f.stage === 'released' ? t('正式') : t('迭代中');
      return {
        title: t('{name}（{stage}）', { name: f.name, stage }),
        value: f.id,
        disabled: !ready,
        selectable: !caseOnly,
        checkable: !caseOnly,
        searchText: [f.name, stage].join(' '),
        children: children.length > 0 ? children : undefined,
      };
    });

  const treeData: FeatureOption[] = visibleProjects.map((p, i) => ({
    title: p.has_model_config
      ? p.name
      : t('{name}（未配大模型，不可选）', { name: p.name }),
    // 父节点要有 value，否则 antd 报 "TreeNode value is invalidate"；但它是系统不是功能。
    // checkable: false 很关键：SHOW_PARENT 下勾满整个系统会把 project:<id> 当成值回传，
    // 后端会把它当功能 id 校验失败。
    value: `project:${p.id}`,
    selectable: false,
    checkable: false,
    searchText: p.name,
    children: toOptions(
      buildFeatureTree(featureQueries[i]?.data ?? []),
      p.has_model_config,
      casesByFeature(caseQueries[i]?.data ?? []),
    ),
  }));

  const blocked = visibleProjects.filter((p) => !p.has_model_config);

  return (
    <>
      <TreeSelect
        treeData={treeData}
        value={value}
        onChange={onChange}
        treeCheckable
        showCheckedStrategy={
          caseOnly ? TreeSelect.SHOW_CHILD : TreeSelect.SHOW_PARENT
        }
        treeDefaultExpandAll
        showSearch
        filterTreeNode={(input, node) =>
          String((node as FeatureOption).searchText ?? '')
            .toLowerCase()
            .includes(input.trim().toLowerCase())
        }
        allowClear
        disabled={disabled}
        placeholder={t(placeholder)}
        style={{ width: '100%', ...style }}
      />
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
        {caseOnly
          ? t('这里只选择用例；可以跨功能勾选，功能节点仅用于分组')
          : t('勾选功能会包含其下所有用例；也可以只勾单个用例')}
      </Typography.Text>
      {blocked.length > 0 && (
        <Typography.Text type="warning" style={{ display: 'block', marginTop: 4 }}>
          {t('有 {count} 个系统未配大模型，其下功能已禁选：{names}', {
            count: blocked.length,
            names: blocked.map((p) => p.name).join(t('、')),
          })}
        </Typography.Text>
      )}
    </>
  );
}