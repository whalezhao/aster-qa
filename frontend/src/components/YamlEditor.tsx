import { useRef, type ChangeEvent, type CSSProperties } from 'react';
import { Input, theme } from 'antd';

/**
 * 带行号的 YAML 编辑框。
 *
 * 左侧行号用绝对定位盖在 TextArea 的 padding 区域上，不额外引入编辑器依赖；
 * 关闭软换行（wrap=off），保证一行 YAML 对应一个行号，行号不会被折行打乱。
 */
export default function YamlEditor({
  value,
  onChange,
  rows = 18,
  placeholder,
  style,
  id,
}: {
  value?: string;
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  placeholder?: string;
  style?: CSSProperties;
  id?: string;
}) {
  const { token } = theme.useToken();
  const gutterRef = useRef<HTMLDivElement>(null);
  const text = value ?? '';
  const lineCount = Math.max(1, text.split('\n').length);
  const numbers = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={gutterRef}
        aria-hidden
        style={{
          position: 'absolute',
          // antd 的 TextArea 自身是 position: relative，且在 DOM 里排在后面；
          // 不给行号栏 z-index 会被不透明的输入框背景整个盖住
          zIndex: 1,
          top: 1,
          bottom: 1,
          left: 1,
          width: 48,
          overflow: 'hidden',
          pointerEvents: 'none',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          borderTopLeftRadius: token.borderRadius,
          borderBottomLeftRadius: token.borderRadius,
          padding: '4px 8px 0 0',
          textAlign: 'right',
          color: token.colorTextTertiary,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 14,
          lineHeight: '22px',
          userSelect: 'none',
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
          }}
        >
          {numbers}
        </pre>
      </div>
      <Input.TextArea
        id={id}
        value={text}
        onChange={onChange}
        rows={rows}
        placeholder={placeholder}
        spellCheck={false}
        wrap="off"
        style={{
          paddingLeft: 60,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          ...style,
        }}
        onScroll={(event) => {
          // 行号跟着文本区一起纵向滚动
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}