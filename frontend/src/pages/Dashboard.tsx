import { useQuery } from '@tanstack/react-query';
import { Alert, Col, Progress, Row, Space, Statistic, Tag, Typography, theme } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import {
  BarChartOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Prompts, Welcome } from '@ant-design/x';
import { Link, useNavigate } from 'react-router-dom';
import { getBatches } from '../api/batches';
import { getStatsOverview } from '../api/stats';
import { getAllTasks } from '../api/tasks';
import { getTeams } from '../api/teams';
import { useAuth } from '../auth/AuthContext';
import AiMascot from '../components/AiMascot';
import { BATCH_STATUS_COLORS, BATCH_STATUS_LABELS, fmtDateTime, fmtPercent } from '../lib/format';
import { useActiveTeam } from '../team/TeamContext';

export default function Dashboard() {
  const { user } = useAuth();
  const { teamId } = useActiveTeam();
  const navigate = useNavigate();
  const { token } = theme.useToken();

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: getTeams });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks-all'], queryFn: getAllTasks });
  const { data: overview } = useQuery({
    queryKey: ['stats-overview', teamId],
    queryFn: () => getStatsOverview({ team_id: teamId ?? undefined }),
  });
  const { data: recent } = useQuery({
    queryKey: ['batches', { team_id: teamId, limit: 5 }],
    queryFn: () => getBatches({ team_id: teamId ?? undefined, limit: 5 }),
    enabled: Boolean(teamId),
  });

  const teamName = teams.find((t) => t.id === teamId)?.name ?? '未选择团队';
  const running = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
  const insufficient = overview ? !overview.sample_sufficient : false;
  const passRate = overview?.final_pass_rate ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
      {/* 欢迎区：AI 形象 + 快捷入口 —— Ant Design X 的 Welcome/Prompts */}
      <ProCard
        className="qa-ai-card"
        bodyStyle={{ padding: 28 }}
        style={{
          background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 55%)`,
        }}
      >
        <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          <AiMascot size={96} state={running > 0 ? 'thinking' : 'happy'} />
          <div style={{ flex: 1, minWidth: 300 }}>
            <Welcome
              variant="borderless"
              title={
                <span style={{ fontSize: 26, fontWeight: 600 }}>
                  欢迎回来，{user?.display_name || user?.username} 👋
                </span>
              }
              description={
                <Space size={8} wrap>
                  <Typography.Text type="secondary">
                    Aster QA · 当前团队「{teamName}」
                  </Typography.Text>
                  {running > 0 && <Tag color="processing">{running} 个任务正在跑</Tag>}
                  {insufficient && <Tag color="warning">统计数据样本不足</Tag>}
                </Space>
              }
            />
            <div style={{ marginTop: 16 }}>
              <Prompts
                wrap
                title="从这里开始"
                items={[
                  {
                    key: 'case',
                    icon: <RobotOutlined style={{ color: token.colorPrimary }} />,
                    label: '用 AI 写一条用例',
                    description: '描述要测什么，AI 生成 YAML',
                  },
                  {
                    key: 'task',
                    icon: <ThunderboltOutlined style={{ color: '#7C5CFF' }} />,
                    label: '发起一次回归',
                    description: '多选功能，勾选任务批量执行',
                  },
                  {
                    key: 'stats',
                    icon: <BarChartOutlined style={{ color: '#22B07D' }} />,
                    label: '看测试统计',
                    description: '通过率趋势、Flaky 榜单',
                  },
                ]}
                onItemClick={({ data }) => {
                  if (data.key === 'stats') navigate('/stats');
                  else if (data.key === 'task') navigate('/tasks');
                  else navigate('/teams');
                }}
              />
            </div>
          </div>
        </div>
      </ProCard>

      {/* 指标卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <ProCard>
            <Statistic
              title="用例通过率"
              value={fmtPercent(passRate)}
              valueStyle={insufficient ? { color: token.colorTextTertiary } : { color: passRate && passRate > 0.9 ? '#22B07D' : undefined }}
              prefix={<ExperimentOutlined />}
            />
            <Typography.Text type={insufficient ? 'warning' : 'secondary'}>
              置信下界 {fmtPercent(overview?.pass_rate_lower_bound ?? null)} · 样本 {overview?.sample_size ?? 0}
            </Typography.Text>
          </ProCard>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <ProCard>
            <Statistic title="执行次数" value={overview?.runs ?? 0} prefix={<PlayCircleOutlined />} />
            <Typography.Text type="secondary">
              覆盖 {overview?.sample_size ?? 0} 个用例
            </Typography.Text>
          </ProCard>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <ProCard>
            <Statistic title="进行中的任务" value={running} prefix={<ThunderboltOutlined />} />
            <Typography.Text type="secondary">共 {tasks.length} 个任务</Typography.Text>
          </ProCard>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <ProCard>
            <Statistic
              title="最近 5 次执行通过率"
              value={
                recent?.items.length
                  ? fmtPercent(
                      recent.items.reduce((sum, b) => sum + b.passed, 0) /
                        Math.max(1, recent.items.reduce((sum, b) => sum + b.total, 0)),
                    )
                  : '-'
              }
              prefix={<BarChartOutlined />}
            />
            <Progress
              percent={
                recent?.items.length
                  ? Math.round(
                      (recent.items.reduce((sum, b) => sum + b.passed, 0) /
                        Math.max(1, recent.items.reduce((sum, b) => sum + b.total, 0))) *
                        100,
                    )
                  : 0
              }
              size="small"
              showInfo={false}
              style={{ marginTop: 6 }}
            />
          </ProCard>
        </Col>
      </Row>

      {(overview?.excluded_infra_runs ?? 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${overview?.excluded_infra_runs} 次执行因模型额度/服务/网络问题被排除在通过率之外`}
          description="这些执行里的用例失败不代表缺陷，不计入上面的通过率。"
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <ProCard
            title="最近执行"
            extra={<Link to="/executions">全部</Link>}
            bodyStyle={{ paddingTop: 8, paddingBottom: 8 }}
          >
            {(recent?.items ?? []).length === 0 ? (
              <Typography.Text type="secondary">这个团队还没有执行记录。</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                {(recent?.items ?? []).map((batch) => (
                  <Link
                    key={batch.id}
                    to={`/executions/${batch.id}`}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}
                  >
                    <Space>
                      <Tag color={BATCH_STATUS_COLORS[batch.status] ?? 'default'}>
                        {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                      </Tag>
                      <span>{batch.name}</span>
                    </Space>
                    <Space size={12}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {batch.passed}/{batch.total}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtDateTime(batch.created_at)}
                      </Typography.Text>
                    </Space>
                  </Link>
                ))}
              </Space>
            )}
          </ProCard>
        </Col>
        <Col xs={24} lg={10}>
          <ProCard title="读数的正确姿势">
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              用例由 AI 驱动执行，<strong>同一个用例时过时不过属于常态，单次失败不等价于缺陷</strong>。
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              通过率要同时看首轮通过率与 Wilson 置信下界，并关注统计页的 Flaky 榜单。
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              想看明细去 <Link to="/stats">统计</Link>，或 <Link to="/executions">执行记录</Link> 看每一份报告。
            </Typography.Paragraph>
          </ProCard>
        </Col>
      </Row>
    </div>
  );
}
