import type { CSSProperties } from 'react';

export type MascotState = 'idle' | 'thinking' | 'happy' | 'alert';

const PALETTE: Record<
  MascotState,
  { shell: string; top: string; bottom: string; screen: string; eye: string; accent: string }
> = {
  idle: {
    shell: '#5C6BFF',
    top: '#8A96FF',
    bottom: '#4149C9',
    screen: '#20285C',
    eye: '#FFFFFF',
    accent: '#B7C6FF',
  },
  thinking: {
    shell: '#7C5CFF',
    top: '#A98CFF',
    bottom: '#5636C9',
    screen: '#2A166B',
    eye: '#FFFFFF',
    accent: '#C9A8FF',
  },
  happy: {
    shell: '#21B98C',
    top: '#5BE0B4',
    bottom: '#14806A',
    screen: '#0B3F35',
    eye: '#FFFFFF',
    accent: '#8FF0CB',
  },
  alert: {
    shell: '#F59A3C',
    top: '#FFC46B',
    bottom: '#B96518',
    screen: '#4A2608',
    eye: '#FFFFFF',
    accent: '#FFD98F',
  },
};

/**
 * 平台的 AI 形象：24×24 像素画的小机器人（方块头 + 屏幕脸 + 身体）。
 *
 * 和 logo 同一套像素语言：硬边、整像素、所有动画走 steps()。
 * 四种状态对应四套配色，用于「正在思考 / 完成 / 需要注意」这些时刻。
 */
export default function AiMascot({
  size = 96,
  state = 'idle',
  style,
}: {
  size?: number;
  state?: MascotState;
  style?: CSSProperties;
}) {
  const c = PALETTE[state];
  const happy = state === 'happy';

  return (
    <div
      className={`qa-mascot qa-mascot--${state}`}
      style={{ width: size, height: size, ...style }}
      role="img"
      aria-label={`AI 助手（${state}）`}
    >
      <svg viewBox="0 0 24 24" width="100%" height="100%" shapeRendering="crispEdges">
        {/* 影子 */}
        <g className="qa-mascot-shadow">
          <rect x="6" y="23" width="12" height="1" fill={c.bottom} opacity="0.22" />
        </g>

        <g className="qa-mascot-body">
          {/* 天线 */}
          <rect x="11" y="3" width="2" height="3" fill={c.bottom} />
          <rect className="qa-mascot-antenna" x="11" y="1" width="2" height="2" fill={c.accent} />

          {/* 头 */}
          <rect x="5" y="6" width="14" height="1" fill={c.shell} />
          <rect x="4" y="7" width="16" height="8" fill={c.shell} />
          <rect x="5" y="15" width="14" height="1" fill={c.shell} />
          <rect x="5" y="7" width="14" height="1" fill={c.top} />
          <rect x="5" y="14" width="14" height="1" fill={c.bottom} />

          {/* 屏幕脸 */}
          <rect x="6" y="8" width="12" height="6" fill={c.screen} />

          {/* 眼睛 */}
          {happy ? (
            <g className="qa-mascot-eyes" fill={c.eye}>
              <rect x="8" y="11" width="2" height="1" />
              <rect x="14" y="11" width="2" height="1" />
            </g>
          ) : (
            <g className="qa-mascot-eyes">
              <rect x="8" y="10" width="2" height="2" fill={c.eye} />
              <rect x="14" y="10" width="2" height="2" fill={c.eye} />
              <rect x="9" y="11" width="1" height="1" fill={c.screen} />
              <rect x="15" y="11" width="1" height="1" fill={c.screen} />
            </g>
          )}

          {/* 嘴 */}
          {happy ? (
            <g fill={c.eye}>
              <rect x="10" y="12" width="1" height="1" />
              <rect x="11" y="13" width="2" height="1" />
              <rect x="13" y="12" width="1" height="1" />
            </g>
          ) : state === 'alert' ? (
            <rect x="11" y="12" width="2" height="2" fill={c.eye} />
          ) : (
            <rect x="11" y="12" width="2" height="1" fill={c.eye} opacity="0.85" />
          )}

          {/* 脖子与身体 */}
          <rect x="10" y="16" width="4" height="1" fill={c.bottom} />
          <rect x="8" y="17" width="8" height="1" fill={c.shell} />
          <rect x="7" y="18" width="10" height="3" fill={c.shell} />
          <rect x="8" y="21" width="8" height="1" fill={c.shell} />
          <rect x="7" y="20" width="10" height="1" fill={c.bottom} />
          <rect className="qa-mascot-core" x="11" y="18" width="2" height="2" fill={c.accent} />

          {/* 脚 */}
          <rect x="9" y="22" width="2" height="1" fill={c.bottom} />
          <rect x="13" y="22" width="2" height="1" fill={c.bottom} />
        </g>
      </svg>
    </div>
  );
}
