import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, theme as antdTheme } from 'antd';
import { XProvider } from '@ant-design/x';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { ProConfigProvider } from '@ant-design/pro-components';
import { enUSIntl, zhCNIntl } from '@ant-design/pro-provider';
import 'antd/dist/reset.css';
import './global.css';
import 'dayjs/locale/zh-cn';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import { LocaleProvider, useLocale } from './i18n/LocaleContext';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** 主题必须在 Provider 之上决定，所以中间隔一层。XProvider 接受 antd 的全部配置。 */
function ThemedRoot() {
  const { isDark } = useTheme();
  const { locale } = useLocale();
  const antdLocale = locale === 'en' ? enUS : zhCN;
  const proIntl = locale === 'en' ? enUSIntl : zhCNIntl;
  return (
    <XProvider
      locale={antdLocale}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 10 },
      }}
    >
      <ProConfigProvider intl={proIntl}>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </ProConfigProvider>
    </XProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocaleProvider>
          <ThemedRoot />
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
