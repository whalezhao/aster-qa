import { useMemo } from 'react';
import { Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { t } from '../i18n';
import type { TestCaseDoc, TestCasePhase } from '../api/types';

interface Props {
  cases: TestCaseDoc[];
}

const PHASE_LABELS: Record<TestCasePhase, string> = {
  precondition: '前置',
  action: '操作',
  wait: '等待',
  assert: '断言',
  cleanup: '清理',
};

const PHASE_COLORS: Record<TestCasePhase, string | undefined> = {
  precondition: undefined,
  action: 'processing',
  wait: 'warning',
  assert: 'success',
  cleanup: undefined,
};

type FlatRow = {
  key: string;
  caseName: string;
  rowSpan: number;
  seq: number;
  kind: string;
  phase: TestCasePhase;
  action: string;
  expected: string | null;
  note: string | null;
};

/** 客户可读的测试用例表：每条 YAML case 一条用例，按步骤列操作和判断逻辑。 */
export default function CaseTestTable({ cases }: Props) {
  const rows = useMemo<FlatRow[]>(
    () =>
      cases.flatMap((doc) => {
        if (!doc.rows.length) {
          return [
            {
              key: `case-${doc.index}-empty`,
              caseName: doc.name,
              rowSpan: 1,
              seq: 0,
              kind: '',
              phase: 'action' as TestCasePhase,
              action: t('（无步骤）'),
              expected: null,
              note: null,
            },
          ];
        }
        return doc.rows.map((row, index) => ({
          key: `case-${doc.index}-${index}`,
          caseName: doc.name,
          rowSpan: index === 0 ? doc.rows.length : 0,
          seq: index + 1,
          ...row,
        }));
      }),
    [cases],
  );

  const columns: TableColumnsType<FlatRow> = [
    {
      title: t('用例'),
      dataIndex: 'caseName',
      width: 180,
      onCell: (row) => ({ rowSpan: row.rowSpan }),
      render: (value: string) => (
        <Typography.Text strong style={{ fontSize: 12 }}>
          {value}
        </Typography.Text>
      ),
    },
    { title: t('序号'), dataIndex: 'seq', width: 56, align: 'center' },
    {
      title: t('阶段'),
      dataIndex: 'phase',
      width: 76,
      render: (phase: TestCasePhase) => (
        <Tag color={PHASE_COLORS[phase]} style={{ marginInlineEnd: 0 }}>
          {t(PHASE_LABELS[phase] ?? phase)}
        </Tag>
      ),
    },
    {
      title: t('测试步骤'),
      dataIndex: 'action',
      render: (value: string) => <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>,
    },
    {
      title: t('预期结果 / 判断逻辑'),
      dataIndex: 'expected',
      render: (value: string | null) =>
        value ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: t('备注'),
      dataIndex: 'note',
      width: 200,
      render: (value: string | null) =>
        value ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
  ];

  return (
    <Table<FlatRow>
      rowKey="key"
      size="small"
      bordered
      pagination={false}
      dataSource={rows}
      columns={columns}
      scroll={{ x: 980 }}
      locale={{ emptyText: t('还没有测试用例') }}
    />
  );
}