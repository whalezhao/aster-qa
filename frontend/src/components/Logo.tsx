import type { CSSProperties } from 'react';

export type LogoMood = 'idle' | 'happy' | 'alert' | 'thinking';

const PALETTE: Record<LogoMood, { main: string; accent: string }> = {
  idle: { main: '#6A6BFF', accent: '#4F8CFF' },
  happy: { main: '#21B98C', accent: '#5BE0B4' },
  alert: { main: '#F59A3C', accent: '#FFC46B' },
  thinking: { main: '#8B5CFF', accent: '#B45CFF' },
};

/**
 * 平台 logo：12 道放射状的光芒（长短交替），像一朵星芒 / 火花。
 *
 * 不是机器人 —— 品牌标记越抽象，缩到 favicon 尺寸越清楚。
 * 长短光条交替 + 中心光晕，整体缓慢旋转；不同状态换配色和转速。
 */
export default function Logo({
  size = 36,
  mood = 'idle',
  style,
}: {
  size?: number;
  mood?: LogoMood;
  style?: CSSProperties;
}) {
  const c = PALETTE[mood];
  return (
    <span
      className={`qa-logo qa-logo--${mood}`}
      style={{ width: size, height: size, ...style }}
      role="img"
      aria-label={`Aster QA（${mood}）`}
    >
      <svg viewBox="0 0 48 48" width="100%" height="100%">
        <circle className="qa-logo-halo" cx="24" cy="24" r="15" fill={c.accent} opacity="0.18" />
        <g className="qa-logo-burst">
          {Array.from({ length: 12 }, (_, index) => {
            const long = index % 2 === 0;
            // 长光条伸到接近边缘，短光条收一半；内端收成一点，形成放射感
            const tip = long ? 3.6 : 9;
            const width = long ? 1.75 : 1.45;
            return (
              <path
                key={index}
                d={`M24 ${tip} L${24 + width} 20.4 L24 24 L${24 - width} 20.4 Z`}
                fill={long ? c.main : c.accent}
                opacity={long ? 1 : 0.9}
                transform={`rotate(${index * 30} 24 24)`}
              />
            );
          })}
        </g>
      </svg>
    </span>
  );
}
