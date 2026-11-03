import { useMemo, type ReactNode } from 'react';
import { theme, Typography } from 'antd';
import { t } from '../i18n';

/** 渲染后端返回的 unified diff 文本。 */
export default function UnifiedDiff({ diff }: { diff: string }) {
  const { token } = theme.useToken();
  const lines = useMemo(() => (diff || t('(没有差异)')).split('\n'), [diff]);
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        maxHeight: 420,
        overflow: 'auto',
        background: token.colorFillQuaternary,
        borderRadius: token.borderRadius,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {lines.map((line, index) => {
        const color = line.startsWith('+') && !line.startsWith('+++')
          ? token.colorSuccess
          : line.startsWith('-') && !line.startsWith('---')
            ? token.colorError
            : line.startsWith('@@')
              ? token.colorTextTertiary
              : token.colorText;
        return (
          <div key={index} style={{ color, whiteSpace: 'pre-wrap' }}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

export function DiffLabel({ children }: { children: ReactNode }) {
  return <Typography.Text type="secondary">{children}</Typography.Text>;
}
