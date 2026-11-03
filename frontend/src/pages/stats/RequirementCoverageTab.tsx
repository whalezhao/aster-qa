import { Alert, Card, Col, Empty, Progress, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getRequirementCoverage, type CoverageParams } from '../../api/coverage';
import { fmtDateTime, fmtPercent } from '../../lib/format';
import { t } from '../../i18n';
import type { CoverageItem } from '../../api/types';

const STATUS: Record<CoverageItem['status'], { label: string; color: string }> = {
  covered: { label: '已覆盖', color: 'green' },
  partial: { label: '部分执行', color: 'blue' },
  not_run: { label: '未执行', color: 'default' },
  infra: { label: '环境异常', color: 'orange' },
  failed: { label: '有失败', color: 'red' },
  gap: { label: '无用例', color: 'purple' },
};

export default function RequirementCoverageTab({ params }: { params: CoverageParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stats-coverage', params],
    queryFn: () => getRequirementCoverage(params),
    enabled: Boolean(params.team_id || params.project_id),
  });

  if (!isLoading && !data?.requirements.length) {
    return (
      <Card>
        <Empty
          description={
            <Space direction="vertical" size={0}>
              <Typography.Text>{t('还没有可统计的需求编号')}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('到「项目 → 功能」里给功能填上需求编号（禅道/Jira），这里就会生成覆盖矩阵。')}
              </Typography.Text>
            </Space>
          }
        />
      </Card>
    );
  }

  const summary = data?.summary ?? {};
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={12}>
        {[
          [t('需求总数'), summary.total ?? 0, undefined],
          [t('已覆盖'), summary.covered ?? 0, 'green'],
          [t('有失败'), summary.failed ?? 0, 'red'],
          [t('未执行'), summary.not_run ?? 0, 'default'],
          [t('无用例'), summary.gap ?? 0, 'purple'],
        ].map(([title, value]) => (
          <Col span={4} key={String(title)}>
            <Card size="small">
              <Statistic title={title} value={Number(value)} />
            </Card>
          </Col>
        ))}
        <Col span={4}>
          <Card size="small">
            <Statistic title={t('未填需求的功能')} value={summary.unmapped_features ?? 0} />
          </Card>
        </Col>
      </Row>

      {Boolean(summary.failed) && (
        <Alert
          type="warning"
          showIcon
          message={t('有 {n} 个需求最近一次执行存在失败用例', { n: summary.failed })}
          description={t('这里只统计「最近一次有效结果」；模型/网络导致的运行失败会标为环境异常，不会算成产品失败。')}
        />
      )}

      <Table
        size="small"
        rowKey="requirement_id"
        loading={isLoading}
        dataSource={data?.requirements ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        columns={[
          {
            title: t('需求'),
            dataIndex: 'requirement_id',
            width: 150,
            render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
          },
          {
            title: t('功能'),
            dataIndex: 'features',
            render: (features: string[], row) => (
              <Space wrap>
                {features.map((name, index) => (
                  <Link key={`${name}-${index}`} to={`/features/${row.feature_ids[index]}`}>
                    {name}
                  </Link>
                ))}
              </Space>
            ),
          },
          {
            title: t('项目'),
            dataIndex: 'projects',
            render: (projects: string[]) => projects.join(t('、')) || '-',
          },
          { title: t('用例'), dataIndex: 'case_count', width: 70 },
          {
            title: t('覆盖'),
            dataIndex: 'coverage_rate',
            width: 160,
            render: (value: number, row) => (
              <Progress
                percent={Math.round(value * 100)}
                size="small"
                status={row.status === 'failed' ? 'exception' : undefined}
              />
            ),
          },
          {
            title: t('通过率'),
            dataIndex: 'pass_rate',
            width: 90,
            render: (value: number | null) => (value == null ? '-' : fmtPercent(value * 100)),
          },
          {
            title: t('状态'),
            dataIndex: 'status',
            width: 100,
            render: (value: CoverageItem['status']) => (
              <Tag color={STATUS[value].color}>{t(STATUS[value].label)}</Tag>
            ),
          },
          {
            title: t('最近执行'),
            dataIndex: 'last_run_at',
            width: 170,
            render: (value: string | null) => fmtDateTime(value),
          },
        ]}
      />
    </Space>
  );
}
