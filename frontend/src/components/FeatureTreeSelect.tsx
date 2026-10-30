import { useQueries, useQuery } from '@tanstack/react-query';
import { TreeSelect, Typography } from 'antd';
import { getFeatures } from '../api/features';
import { getProjects } from '../api/projects';

/**
 * 「项目 → 功能」两级多选。新建任务和新建回归都用它。
 *
 * 没配好大模型的项目，其下功能直接不可选 —— 选了也跑不了，不如一开始就拦住。
 * 判定口径以后端的 has_model_config 为准。
 */
export default function FeatureTreeSelect({
  teamId,
  value,
  onChange,
  placeholder = '按项目选择功能',
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

  const treeData = projects.map((p, i) => {
    const ready = p.has_model_config;
    return {
      title: ready ? p.name : `${p.name}（未配大模型，不可选）`,
      // 父节点要有 value，否则 antd 报 "TreeNode value is invalidate"；但它是项目不是功能，
      // 所以标成不可选，配合 SHOW_CHILD 策略，选中值里只会出现功能的 id
      value: `project:${p.id}`,
      selectable: false,
      children: (featureQueries[i]?.data ?? []).map((f) => ({
        title: `${f.name}（${f.stage === 'released' ? '正式' : '迭代中'}）`,
        value: f.id,
        disabled: !ready,
      })),
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
        showCheckedStrategy={TreeSelect.SHOW_CHILD}
        treeDefaultExpandAll
        allowClear
        disabled={disabled}
        placeholder={placeholder}
        style={{ width: '100%', ...style }}
      />
      {blocked.length > 0 && (
        <Typography.Text type="warning" style={{ display: 'block', marginTop: 4 }}>
          有 {blocked.length} 个项目未配大模型，其下功能已禁选：{blocked.map((p) => p.name).join('、')}
        </Typography.Text>
      )}
    </>
  );
}
