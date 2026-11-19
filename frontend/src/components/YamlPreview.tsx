import { useMemo } from 'react';
import { theme } from 'antd';

/** 只读 YAML 预览，带行号。用于版本查看 / AI 修复建议这类不可编辑的 YAML。 */
export default function YamlPreview({
  code,
  maxHeight = 520,
}: {
  code: string;
  maxHeight?: number;
}) {
  const { token } = theme.useToken();
  const lines = useMemo(() => (code || '').split('\n'), [code]);

  return (
    <pre
      style={{
        margin: 0,
        maxHeight,
        overflow: 'auto',
        background: token.colorFillQuaternary,
        borderRadius: token.borderRadius,
        padding: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {lines.map((line, index) => (
        <div key={index} style={{ display: 'flex' }}>
          <span
            style={{
              flex: '0 0 36px',
              width: 36,
              textAlign: 'right',
              marginRight: 12,
              color: token.colorTextQuaternary,
              userSelect: 'none',
            }}
          >
            {index + 1}
          </span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line || ' '}</span>
        </div>
      ))}
    </pre>
  );
}