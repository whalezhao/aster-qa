import { useQueries, useQuery } from '@tanstack/react-query';
import { TreeSelect, Typography } from 'antd';
import { getFeatures } from '../api/features';
import { getProjects } from '../api/projects';
import { t } from '../i18n';
import { buildFeatureTree, type FeatureNode } from '../lib/featureTree';

interface FeatureOption {
  title: string;
  value: string;
  disabled: boolean;
  children?: FeatureOption[];
}

/**
 * 「系统 → 功能树」多选。新建任务和新建回归都用它。
 *
 * 没配好大模型的系统，其下功能直接不可选 —— 选了也跑不了，不如一开始就拦住。
 * 判定口径以后端的 has_model_config 为准。
 */
export default function FeatureTreeSelect({
  teamId,
  value,
  onChange,
  placeholder = '按系统选择功能',
  style,
  disabled = false,
}: {
  teamId: string | null;
  value?: string[];
  onChange?: (ids: string[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => getProjects(teamId as string),
    enabled: Boolean(teamId),
  });

  const featureQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['features', p.id, 'all'],
      queryFn: () => getFeatures(p.id),
      enabled: Boolean(teamId),
    })),
  });

  const toOptions = (nodes: FeatureNode[], ready: boolean): FeatureOption[] =>
    nodes.map((f) => ({
      title: t('{name}（{stage}）', {
        name: f.name,
        stage: f.stage === 'released' ? t('正式') : t('迭代中'),
      }),
      value: f.id,
      disabled: !ready,
      children: f.children ? toOptions(f.children, ready) : undefined,
    }));

  const treeData = projects.map((p, i) => {
    const ready = p.has_model_config;
    return {
      title: ready ? p.name : t('{name}（未配大模型，不可选）', { name: p.name }),
      // 父节点要有 value，否则 antd 报 "TreeNode value is invalidate"；但它是系统不是功能。
      // checkable: false 很关键：SHOW_PARENT 下勾满整个系统会把 project:<id> 当成值回传，
      // 后端会把它当功能 id 校验失败。
      value: `project:${p.id}`,
      selectable: false,
      checkable: false,
      children: toOptions(buildFeatureTree(featureQueries[i]?.data ?? []), ready),
    };
  });

  const blocked = projects.filter((p) => !p.has_model_config);

  return (
    <>
      <TreeSelect
        treeData={treeData}
        value={value}
        onChange={onChange}
        treeCheckable
        showCheckedStrategy={TreeSelect.SHOW_PARENT}
        treeDefaultExpandAll
        allowClear
        disabled={disabled}
        placeholder={t(placeholder)}
        style={{ width: '100%', ...style }}
      />
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
        {t('勾选父功能会包含其下所有子功能的用例')}
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
