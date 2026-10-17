import type { CSSProperties } from 'react';
import { Avatar } from 'antd';

/**
 * 内置卡通扁平头像。
 *
 * 不做上传：一个头像就是一组配色 + 发型，前端画 SVG。好处是两套主题下都干净、
 * 不会因为图片格式/裁剪出问题，也没有存储和 CDN 的事。
 * 用户选的只是 `key`，存进 users.avatar。
 */
export interface AvatarPreset {
  key: string;
  bg: string;
  skin: string;
  hair: string;
  style: 'short' | 'bob' | 'bun' | 'buzz' | 'long';
  glasses?: boolean;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: 'fox', bg: '#FFE0B2', skin: '#FFD1A6', hair: '#8D5524', style: 'short' },
  { key: 'mint', bg: '#C8F4DE', skin: '#FFE0C2', hair: '#2F7D5B', style: 'bob' },
  { key: 'sky', bg: '#D6E8FF', skin: '#FFDCC0', hair: '#274B7A', style: 'bun' },
  { key: 'lilac', bg: '#E6DEFF', skin: '#F8D2B6', hair: '#5B3E96', style: 'long', glasses: true },
  { key: 'rose', bg: '#FFDDE6', skin: '#FFD9BD', hair: '#9B3B57', style: 'bob' },
  { key: 'sand', bg: '#F4E9C8', skin: '#F2C9A0', hair: '#6B4A2B', style: 'buzz' },
  { key: 'ocean', bg: '#CCEDF5', skin: '#FFDDBE', hair: '#1F5F73', style: 'short', glasses: true },
  { key: 'grape', bg: '#E8DDF7', skin: '#EDBF98', hair: '#3C2A63', style: 'bun' },
  { key: 'leaf', bg: '#DDF2C9', skin: '#FFE3C7', hair: '#3F6B2C', style: 'long' },
  { key: 'sunset', bg: '#FFE2CC', skin: '#F7C9A3', hair: '#A8501F', style: 'short' },
  { key: 'cloud', bg: '#E3E8EF', skin: '#FFD9C0', hair: '#3A4658', style: 'bob', glasses: true },
  { key: 'peach', bg: '#FFE8D6', skin: '#F5C6A0', hair: '#7A3E23', style: 'buzz' },
];

export function avatarPreset(key?: string | null): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((preset) => preset.key === key);
}

function hairShape(preset: AvatarPreset) {
  const { hair, style } = preset;
  switch (style) {
    case 'buzz':
      return <path d="M17 30a15 15 0 0 1 30 0h-4a11 11 0 0 0-22 0z" fill={hair} />;
    case 'bob':
      return <path d="M14 32a18 18 0 0 1 36 0v6h-5v-6a13 13 0 0 0-26 0v6h-5z" fill={hair} />;
    case 'bun':
      return (
        <>
          <circle cx="32" cy="12" r="6" fill={hair} />
          <path d="M16 30a16 16 0 0 1 32 0h-5a11 11 0 0 0-22 0z" fill={hair} />
        </>
      );
    case 'long':
      return (
        <>
          <path d="M14 30a18 18 0 0 1 36 0v16h-6V32a12 12 0 0 0-24 0v14h-6z" fill={hair} />
        </>
      );
    default:
      return <path d="M16 30a16 16 0 0 1 32 0h-6a10 10 0 0 0-20 0z" fill={hair} />;
  }
}

/** 一个头像就是一张 64×64 的小图，size 只是缩放。 */
export function AvatarFigure({ preset, size = 32 }: { preset: AvatarPreset; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`头像 ${preset.key}`}>
      <rect width="64" height="64" rx="14" fill={preset.bg} />
      <circle cx="32" cy="33" r="15" fill={preset.skin} />
      {hairShape(preset)}
      {preset.glasses && (
        <g stroke="#2B2B2B" strokeWidth="1.6" fill="none" opacity="0.85">
          <circle cx="25.5" cy="34" r="4.6" />
          <circle cx="38.5" cy="34" r="4.6" />
          <path d="M30.1 34h3.8" />
        </g>
      )}
      {!preset.glasses && (
        <g fill="#2B2B2B">
          <circle cx="26.5" cy="34" r="1.9" />
          <circle cx="37.5" cy="34" r="1.9" />
        </g>
      )}
      <path
        d="M27 40.5q5 4.2 10 0"
        stroke="#2B2B2B"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** 统一的用户头像：有预设就画卡通脸，没有就回退到首字母。 */
export default function UserAvatar({
  avatar,
  name,
  size = 32,
  style,
}: {
  avatar?: string | null;
  name?: string | null;
  size?: number;
  style?: CSSProperties;
}) {
  const preset = avatarPreset(avatar);
  if (preset) {
    return (
      <span
        style={{
          // 用块级 flex 而不是 inline-flex：放在 antd Space 里时，inline 元素会按
          // 文字基线（那一行 line-height 可能有 44px）对齐，导致头像整体偏高、容器被撑高
          display: 'flex',
          lineHeight: 0,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: size * 0.28,
          overflow: 'hidden',
          flex: 'none',
          ...style,
        }}
      >
        <AvatarFigure preset={preset} size={size} />
      </span>
    );
  }
  return (
    <Avatar size={size} style={{ background: '#1677ff', ...style }}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </Avatar>
  );
}
