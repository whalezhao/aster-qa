import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Dropdown, Form, Input, Modal, Select, Space, theme } from 'antd';
import { ProLayout } from '@ant-design/pro-components';
import {
  AppstoreOutlined,
  BarChartOutlined,
  ClusterOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  MoonOutlined,
  PlayCircleOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { getTeams } from '../api/teams';
import { changePassword } from '../api/auth';
import { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getActiveTeamId, setActiveTeamId } from '../storage';
import { TeamProvider } from '../team/TeamContext';
import { useTheme } from '../theme/ThemeContext';
import UserAvatar from '../components/UserAvatar';
import AgentPresence from '../components/AgentPresence';

const TITLE = 'Aster QA';

// 入口顺序按使用频率：干活（项目/任务/执行）在前，组织和配置（团队/人员）在后
const menuRoutes = [
  { path: '/', name: '工作台', icon: <DashboardOutlined /> },
  { path: '/projects', name: '项目', icon: <AppstoreOutlined /> },
  { path: '/tasks', name: '测试任务', icon: <FileSearchOutlined /> },
  { path: '/executions', name: '执行记录', icon: <PlayCircleOutlined /> },
  { path: '/stats', name: '统计', icon: <BarChartOutlined /> },
  { path: '/teams', name: '团队', icon: <TeamOutlined /> },
  { path: '/users', name: '人员', icon: <UserOutlined /> },
];

/** 详情页（/teams/:id、/runs/:id …）也要让父菜单保持高亮。 */
const MENU_PREFIXES = [
  '/projects',
  '/teams',
  '/users',
  '/tasks',
  '/executions',
  '/runs',
  '/stats',
  '/workers',
];

/**
 * 应用外壳：Ant Design Pro 的 ProLayout（浅色侧栏 + 顶栏），
 * 菜单/折叠/响应式都由 Pro 提供，这里只补三件事：团队切换、主题切换、用户菜单。
 */
export default function AppShell() {
  const { user, logout } = useAuth();
  const { message } = App.useApp();
  const { isDark, toggle } = useTheme();
  const { token } = theme.useToken();
  const location = useLocation();
  const queryClient = useQueryClient();

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: getTeams });
  const [activeTeam, setActiveTeam] = useState<string | null>(getActiveTeamId());
  const [pwdOpen, setPwdOpen] = useState(false);
  const [form] = Form.useForm<{ old_password: string; new_password: string }>();

  // 首次进入或当前团队失效时，落到第一个团队
  useEffect(() => {
    if (teams.length === 0) return;
    if (!activeTeam || !teams.some((t) => t.id === activeTeam)) {
      const first = teams[0].id;
      setActiveTeam(first);
      setActiveTeamId(first);
    }
  }, [teams, activeTeam]);

  function onSwitchTeam(id: string | null) {
    if (!id) return;
    setActiveTeam(id);
    setActiveTeamId(id);
    // 切团队只换数据范围，不把人踢到团队页
    queryClient.invalidateQueries();
  }

  const pwdMutation = useMutation({
    mutationFn: (v: { old_password: string; new_password: string }) =>
      changePassword(v.old_password, v.new_password),
    onSuccess: () => {
      message.success('密码修改成功，请重新登录');
      setPwdOpen(false);
      form.resetFields();
      void logout();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const activePath = MENU_PREFIXES.find((p) => location.pathname.startsWith(p)) ?? '/';
  const canSeeWorkers = user?.teams.some((t) => t.role !== 'member') ?? false;
  const routes = canSeeWorkers
    ? [
        ...menuRoutes.slice(0, 5),
        { path: '/workers', name: '执行器', icon: <ClusterOutlined /> },
        ...menuRoutes.slice(5),
      ]
    : menuRoutes;

  return (
    <>
      <ProLayout
        title={TITLE}
        logo={<AgentPresence size={48} />}
        layout="mix"
        navTheme="light"
        siderWidth={226}
        fixSiderbar
        fixedHeader
        breadcrumbRender={false}
        location={{ pathname: location.pathname }}
        route={{ path: '/', routes }}
        // 页面自己用 PageContainer 控制留白，外层不要再加一层，否则内容会缩进两次
        contentStyle={{ padding: 0 }}
        menuItemRender={(item, dom) => (
          <Link
            to={item.path ?? '/'}
            className={item.path === activePath ? 'qa-menu-active' : undefined}
          >
            {dom}
          </Link>
        )}
        // mix 布局的 logo 在顶栏，侧栏再来一份就重复了
        menuHeaderRender={false}
        actionsRender={() => [
          <Select
            key="team"
            variant="borderless"
            style={{ minWidth: 150 }}
            value={activeTeam ?? undefined}
            placeholder="选择团队"
            onChange={onSwitchTeam}
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
          />,
          <Button
            key="theme"
            type="text"
            aria-label="切换主题"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
          />,
        ]}
        avatarProps={{
          render: () => (
            <Dropdown
              menu={{
                items: [
                  { key: 'pwd', label: '修改密码' },
                  { type: 'divider' },
                  { key: 'logout', label: '退出登录' },
                ],
                onClick: ({ key }) => {
                  if (key === 'pwd') setPwdOpen(true);
                  else if (key === 'logout') void logout();
                },
              }}
            >
              <Space align="center" style={{ cursor: 'pointer', paddingInline: 4, height: 40 }}>
                <UserAvatar
                  avatar={user?.avatar}
                  name={user?.display_name || user?.username}
                  size={30}
                />
                <span style={{ color: token.colorText }}>{user?.display_name || user?.username}</span>
              </Space>
            </Dropdown>
          ),
        }}
        token={{
          sider: {
            colorMenuBackground: token.colorBgContainer,
            colorTextMenu: token.colorTextSecondary,
            colorTextMenuSelected: token.colorPrimary,
            colorBgMenuItemSelected: token.colorPrimaryBg,
            colorBgMenuItemHover: token.colorFillQuaternary,
          },
          header: {
            colorBgHeader: token.colorBgContainer,
            colorHeaderTitle: token.colorText,
          },
        }}
      >
        {/* 当前团队只在这里提供，页面不再各存一份 */}
        <TeamProvider value={{ teamId: activeTeam, setTeamId: onSwitchTeam }}>
          <Outlet />
        </TeamProvider>
      </ProLayout>

      <Modal
        title="修改密码"
        open={pwdOpen}
        onCancel={() => setPwdOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={pwdMutation.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => pwdMutation.mutate(v)} preserve={false}>
          <Form.Item name="old_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="new_password" label="新密码" rules={[{ required: true, message: '请输入新密码' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
