import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result, Typography } from 'antd';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 顶层错误边界。
 *
 * 之前任何一个页面在渲染阶段抛错（例如接口返回的结构和预期不一致），React 会卸载整棵树
 * —— 用户看到的是一整片白屏，连侧栏都没了。这里兜住，至少留一个能刷新回去的页面。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 控制台留完整堆栈，排查时先看这里
    console.error('页面渲染异常', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Result
        status="500"
        title={t('这个页面出错了')}
        subTitle={t('刷新一下通常能恢复；如果反复出现，请把下面的信息发给管理员。')}
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            {t('重新加载')}
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {error.message}
        </Typography.Paragraph>
      </Result>
    );
  }
}
