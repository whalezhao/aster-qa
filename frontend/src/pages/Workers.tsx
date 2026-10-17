import { Alert, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { getWorkerStatus } from '../api/workers';
import { fmtDateTime, fmtDuration } from '../lib/format';

export default function Workers() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['workers-status'],
    queryFn: getWorkerStatus,
    refetchInterval: 5000,
  });

  return (
    <PageContainer
      ghost
      header={{
        title: '执行器',
        subTitle: 'worker 心跳、槽位与队列深度，每 5 秒刷新',
      }}
    >
      {isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="没有权限或服务不可用"
          description={String(error)}
        />
      )}
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="在线执行器" value={data?.workers.length ?? 0} suffix="个" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="活跃执行"
              value={data?.active_runs ?? 0}
              suffix={`/ ${data?.max_concurrent_runs ?? '-'}`}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="排队中" value={data?.queued_runs ?? 0} suffix="个 run" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均执行耗时"
              value={data?.avg_duration_ms ? fmtDuration(data.avg_duration_ms) : '-'}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 16 }} loading={isLoading} title="执行器列表">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.workers ?? []}
          locale={{ emptyText: '没有在线执行器' }}
          columns={[
            {
              title: 'Worker',
              dataIndex: 'id',
              render: (id: string, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text code>{id.slice(0, 12)}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.hostname ?? '-'} · pid {row.pid ?? '-'}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '槽位',
              dataIndex: 'slots',
              width: 110,
              render: (slots: number, row) => (
                <Tag color={row.active_runs >= slots ? 'orange' : 'green'}>
                  {row.active_runs} / {slots}
                </Tag>
              ),
            },
            {
              title: '心跳',
              dataIndex: 'heartbeat_at',
              render: (value: string | null) => fmtDateTime(value),
            },
            {
              title: '启动时间',
              dataIndex: 'started_at',
              render: (value: string | null) => fmtDateTime(value),
            },
          ]}
        />
        {Boolean(data?.stale_workers) && (
          <Typography.Text type="warning" style={{ display: 'block', marginTop: 12 }}>
            另有 {data?.stale_workers} 个失联 worker 心跳；它们名下的 run 会被自动恢复。
          </Typography.Text>
        )}
        {data?.oldest_queue_seconds != null && data.queued_runs > 0 && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            最早排队的 run 已等待 {fmtDuration(data.oldest_queue_seconds * 1000)}。
          </Typography.Text>
        )}
      </Card>
    </PageContainer>
  );
}
