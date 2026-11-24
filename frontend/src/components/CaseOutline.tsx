import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Grid, Input, Space, Tag, Tree, Typography, theme } from 'antd';
import type { TreeDataNode } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { stepKindLabel, type Step } from '../lib/caseYaml';

interface Props {
  steps: Step[];
  onJump: (key: string) => void;
}

interface CaseGroup {
  case_index: number;
  name: string;
  steps: Step[];
}

/** 用例/步骤目录：大 YAML 里按用例名、操作、断言快速定位。 */
export default function CaseOutline({ steps, onJump }: Props) {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const [query, setQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const initialized = useRef(false);

  const cases = useMemo(() => {
    const grouped = new Map<number, CaseGroup>();
    for (const step of steps) {
      let group = grouped.get(step.case_index);
      if (!group) {
        group = { case_index: step.case_index, name: step.case, steps: [] };
        grouped.set(step.case_index, group);
      }
      group.steps.push(step);
    }
    return [...grouped.values()].sort((a, b) => a.case_index - b.case_index);
  }, [steps]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return cases;
    const out: CaseGroup[] = [];
    for (const group of cases) {
      const caseHit = group.name.toLowerCase().includes(q);
      const hits = group.steps.filter((step) =>
        `${stepKindLabel(step.kind)} ${step.kind} ${step.text}`.toLowerCase().includes(q),
      );
      if (caseHit) out.push(group);
      else if (hits.length) out.push({ ...group, steps: hits });
    }
    return out;
  }, [cases, q]);

  useEffect(() => {
    if (q) {
      setExpandedKeys(filtered.map((group) => `case-${group.case_index}`));
    } else if (!initialized.current && cases.length <= 3) {
      // 只在首次加载时默认展开；用户手动收起后不再强行展开
      setExpandedKeys(cases.map((group) => `case-${group.case_index}`));
    }
    if (cases.length) initialized.current = true;
  }, [q, filtered, cases]);

  const stepCount = filtered.reduce((sum, group) => sum + group.steps.length, 0);
  const treeData: TreeDataNode[] = filtered.map((group) => {
    const children = group.steps.map((step) => ({
      key: `step-${step.case_index}-${step.index}`,
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
          <Tag color="processing" style={{ marginInlineEnd: 0 }}>
            {stepKindLabel(step.kind)}
          </Tag>
          <Typography.Text
            style={{ fontSize: 12, maxWidth: 150 }}
            ellipsis={{ tooltip: step.text }}
          >
            {step.text}
          </Typography.Text>
        </span>
      ),
    }));
    return {
      key: `case-${group.case_index}`,
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <Typography.Text
            strong
            style={{ fontSize: 12, maxWidth: 150 }}
            ellipsis={{ tooltip: group.name }}
          >
            {group.name || t('用例 {n}', { n: group.case_index + 1 })}
          </Typography.Text>
          <Tag style={{ marginInlineEnd: 0 }}>{t('{n} 步', { n: group.steps.length })}</Tag>
        </span>
      ),
      ...(children.length ? { children } : {}),
    };
  });

  const box = {
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 10,
    background: token.colorFillQuaternary,
    padding: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  };

  if (!steps.length) {
    return (
      <div style={box}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('YAML 解析出步骤后显示目录')}
        </Typography.Text>
      </div>
    );
  }

  return (
    <div style={box}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Typography.Text strong style={{ fontSize: 12 }}>
          {t('目录')}
        </Typography.Text>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {t('{cases} 个用例 · {steps} 步', { cases: filtered.length, steps: stepCount })}
          </Typography.Text>
          <Button
            type="link"
            size="small"
            onClick={() =>
              setExpandedKeys(
                expandedKeys.length
                  ? []
                  : filtered.map((group) => `case-${group.case_index}`),
              )
            }
          >
            {expandedKeys.length ? t('收起') : t('展开')}
          </Button>
        </Space>
      </Space>
      <Input
        size="small"
        allowClear
        prefix={<SearchOutlined />}
        placeholder={t('搜索用例名 / 操作 / 断言')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {filtered.length ? (
        <Tree
          blockNode
          showLine
          height={screens.lg ? 540 : 280}
          treeData={treeData}
          expandedKeys={expandedKeys}
          selectedKeys={selectedKeys}
          onExpand={(keys) => setExpandedKeys(keys.map(String))}
          onSelect={(keys) => {
            const key = String(keys[0] ?? '');
            if (!key) return;
            setSelectedKeys([key]);
            onJump(key);
          }}
        />
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('没有匹配的用例或步骤')}
        </Typography.Text>
      )}
    </div>
  );
}