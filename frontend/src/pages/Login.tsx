import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Form, Grid, Input, Space, Tag, theme, Typography } from 'antd';
import { LockOutlined, MoonOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import AiMascot from '../components/AiMascot';
import Logo from '../components/Logo';

/** 左上角的小标志：圆角方块 + 一个「A」形的 AI 火花，纯 SVG，不依赖图片。 */
const HIGHLIGHTS = [
  '用例由 AI 生成与维护，人只做审阅和签名',
  '一次执行穿透到每个功能、每条用例、每份报告',
  '统计口径带 Wilson 下界，不被偶发失败带偏',
];

export default function Login() {
  const { login } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const wide = Boolean(screens.lg);
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      await login(values.username, values.password);
      navigate('/', { replace: true });
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        background: isDark
          ? 'radial-gradient(1100px 560px at 12% 8%, #182642 0%, #141414 58%)'
          : 'radial-gradient(1100px 560px at 12% 8%, #e8f0ff 0%, #f4f6fb 58%)',
      }}
    >
      {/* 两块模糊光斑，只是氛围，不承载信息 */}
      <div
        style={{
          position: 'absolute',
          width: 460,
          height: 460,
          borderRadius: '50%',
          top: -160,
          left: -120,
          background: isDark ? 'rgba(79,140,255,0.22)' : 'rgba(79,140,255,0.16)',
          filter: 'blur(110px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 380,
          height: 380,
          borderRadius: '50%',
          bottom: -180,
          right: -80,
          background: isDark ? 'rgba(124,92,255,0.20)' : 'rgba(124,92,255,0.14)',
          filter: 'blur(120px)',
        }}
      />

      <Button
        shape="circle"
        aria-label="切换主题"
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        style={{ position: 'absolute', top: 24, right: 24 }}
      />

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 1040,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 72,
        }}
      >
        {wide && (
          <div style={{ flex: 1, maxWidth: 520 }}>
            <Space align="center" size={12} style={{ marginBottom: 20 }}>
              <Logo size={48} />
              <Typography.Text style={{ fontSize: 17, fontWeight: 600 }}>
                Aster QA
              </Typography.Text>
            </Space>
            <AiMascot size={96} state="idle" style={{ marginBottom: 4 }} />
            <Typography.Title level={1} style={{ margin: 0, fontSize: 42, lineHeight: 1.22 }}>
              让 AI 跑测试，
              <br />
              人只需要看结论
            </Typography.Title>
            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: 20, marginBottom: 28, fontSize: 15, maxWidth: 460 }}
            >
              团队、项目、功能、用例一条链管到底：AI 生成用例、执行产生报告、人工签名背书、
              webhook 把结果送回你的工单系统。
            </Typography.Paragraph>
            <Space direction="vertical" size={10}>
              {HIGHLIGHTS.map((item) => (
                <Space key={item} align="start">
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      marginTop: 8,
                      borderRadius: 3,
                      background: token.colorPrimary,
                    }}
                  />
                  <Typography.Text type="secondary">{item}</Typography.Text>
                </Space>
              ))}
            </Space>
          </div>
        )}

        <div
          style={{
            width: 400,
            maxWidth: '100%',
            borderRadius: 18,
            padding: 32,
            background: token.colorBgContainer,
            boxShadow: isDark
              ? '0 24px 60px rgba(0,0,0,0.55)'
              : '0 24px 60px rgba(31,56,110,0.14)',
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {!wide && (
            <Space align="center" size={10} style={{ marginBottom: 24 }}>
              <AiMascot size={48} state="idle" />
              <Typography.Text strong>Aster QA</Typography.Text>
            </Space>
          )}
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
            登录
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
            <Tag color="blue" style={{ marginRight: 8 }}>
              内部系统
            </Tag>
            账号由团队管理员在「人员」里维护
          </Typography.Paragraph>

          <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" autoFocus />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
                autoComplete="current-password"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ marginTop: 4 }}>
              登录
            </Button>
          </Form>

          <Typography.Paragraph type="secondary" style={{ marginTop: 20, marginBottom: 0, fontSize: 12 }}>
            忘记密码请找团队管理员重置 —— 系统不提供自助找回。
          </Typography.Paragraph>
        </div>
      </div>
    </div>
  );
}
