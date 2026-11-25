import { useRef, useState } from 'react';

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * 横向拖拽分栏的百分比状态。
 * 百分比以容器宽度为基准，限制在 [min, max]，并写入 localStorage。
 */
export function useResizablePercent(
  storageKey: string,
  initial: number,
  min = 20,
  max = 80,
) {
  const [percent, setPercent] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= min && saved <= max
        ? saved
        : initial;
    } catch {
      return initial;
    }
  });
  const percentRef = useRef(percent);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const updateFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const next = clamp(((clientX - rect.left) / rect.width) * 100, min, max);
    percentRef.current = next;
    setPercent(next);
  };

  const stopDragging = () => {
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try {
      localStorage.setItem(storageKey, String(percentRef.current));
    } catch {
      /* 隐私模式下 localStorage 可能不可用 */
    }
  };

  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': Math.round(min),
    'aria-valuemax': Math.round(max),
    'aria-valuenow': Math.round(percent),
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current) updateFromClientX(event.clientX);
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      stopDragging();
    },
    onPointerCancel: () => {
      if (dragging.current) stopDragging();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      const next = clamp(
        percentRef.current + (event.key === 'ArrowRight' ? step : -step),
        min,
        max,
      );
      percentRef.current = next;
      setPercent(next);
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        /* ignore */
      }
    },
  };

  return { percent, containerRef, handleProps };
}