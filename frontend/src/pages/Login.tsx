import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Form, Grid, Input, theme, Typography } from 'antd';
import { LockOutlined, MoonOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import AiMascot from '../components/AiMascot';
import Logo from '../components/Logo';
import LocaleSwitch from '../i18n/LocaleSwitch';
import { t } from '../i18n';

const HIGHLIGHTS = [
  '用例由 AI 生成与维护，人只做审阅和签名',
  '一次执行穿透到每个功能、每条用例、每份报告',
  '统计口径带 Wilson 下界，不被偶发失败带偏',
];

/** 品牌区：机器人 + 字标。登录页和卡片顶部共用，只是尺寸不同。 */
function BrandLockup({
  size,
  compact = false,
}: {
  size: number;
  compact?: boolean;
}) {
  const { token } = theme.useToken();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 14 }}>
      <div
        style={{
          width: size + 20,
          height: size + 20,
          flex: 'none',
          borderRadius: compact ? 12 : 18,
          display: 'grid',
          placeItems: 'center',
          background: token.colorPrimaryBg,
        }}
      >
        <AiMascot size={size} state="idle" />
      </div>
      <Typography.Text
        style={{
          fontSize: compact ? 16 : 19,
          fontWeight: 650,
          letterSpacing: -0.2,
          lineHeight: 1.2,
        }}
      >
        Aster QA
      </Typography.Text>
    </div>
  );
}

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
      className="qa-login"
      style={{
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: wide ? '64px 48px' : '40px 20px',
        background: token.colorBgLayout,
      }}
    >
      {/* logo 放大成背景纹理：中心压在左下角，屏幕上只留星芒的右上四分之一 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: '200vmax',
          height: '200vmax',
          left: 0,
          bottom: 0,
          transform: 'translate(-50%, 50%)',
          opacity: isDark ? 0.12 : 0.14,
          pointerEvents: 'none',
        }}
      >
        <div className="qa-login-texture-inner">
          <Logo size={48} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
      </div>

      <div style={{ position: 'absolute', top: 24, right: 24, display: 'flex', gap: 8 }}>
        <LocaleSwitch circle />
        <Button
          shape="circle"
          aria-label={t('切换主题')}
          icon={isDark ? <SunOutlined /> : <MoonOutlined />}
          onClick={toggle}
        />
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 1160,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'clamp(40px, 6vw, 96px)',
        }}
      >
        {wide && (
          <div style={{ flex: 1, minWidth: 0, maxWidth: 560 }}>
            <BrandLockup size={40} />
            <Typography.Title
              level={1}
              style={{
                margin: '44px 0 0',
                fontSize: 'clamp(40px, 4.2vw, 56px)',
                lineHeight: 1.12,
                letterSpacing: -1.2,
              }}
            >
              {t('让 AI 跑测试，')}
              <br />
              {t('人只需要看结论')}
            </Typography.Title>
            <Typography.Paragraph
              style={{
                margin: '24px 0 0',
                fontSize: 16,
                lineHeight: 1.7,
                maxWidth: 460,
                color: token.colorTextSecondary,
              }}
            >
              {t(
                '测试团队、系统、功能、用例一条链管到底：AI 生成用例、执行产生报告、人工签名背书、webhook 把结果送回你的工单系统。',
              )}
            </Typography.Paragraph>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 32 }}>
              {HIGHLIGHTS.map((item) => (
                <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      marginTop: 9,
                      flex: 'none',
                      borderRadius: 1,
                      background: token.colorPrimary,
                    }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 15 }}>
                    {t(item)}
                  </Typography.Text>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            width: 400,
            maxWidth: '100%',
            flex: 'none',
            borderRadius: 22,
            padding: wide ? 36 : 26,
            background: token.colorBgElevated,
          }}
        >
          {!wide && (
            <div style={{ marginBottom: 28 }}>
              <BrandLockup size={32} compact />
            </div>
          )}
          <Typography.Title level={2} style={{ margin: 0, fontSize: 26, letterSpacing: -0.4 }}>
            {t('登录')}
          </Typography.Title>
          <Typography.Paragraph
            type="secondary"
            style={{ margin: '8px 0 28px', fontSize: 13, lineHeight: 1.6 }}
          >
            {t('账号由测试团队管理员在「人员」里维护，忘记密码也找管理员重置。')}
          </Typography.Paragraph>

          <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
            <Form.Item
              name="username"
              label={t('用户名')}
              rules={[{ required: true, message: t('请输入用户名') }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder={t('用户名')}
                autoComplete="username"
                autoFocus
              />
            </Form.Item>
            <Form.Item
              name="password"
              label={t('密码')}
              rules={[{ required: true, message: t('请输入密码') }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={t('密码')}
                autoComplete="current-password"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{ marginTop: 8, boxShadow: 'none' }}
            >
              {t('登录')}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
