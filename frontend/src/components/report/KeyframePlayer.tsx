import { useEffect, useState } from 'react';
import { Button, Image } from 'antd';
import { PauseCircleFilled, PlayCircleFilled } from '@ant-design/icons';
import type { ReportKeyframe } from '../../api/runs';

/**
 * 关键帧回放：原版报告里那个「视频」其实也是截图序列，没有 video 元素。
 * 这里用同样的方式——大图 + 播放/暂停 + 滑块 + 缩略帧，按截图时间节奏推进。
 */
export default function KeyframePlayer({
  frames,
  assetBase,
}: {
  frames: ReportKeyframe[];
  assetBase: string;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const current = frames[index];
    const next = frames[index + 1];
    const gap = (next?.time ?? 0) - (current?.time ?? 0);
    // 真实间隔可能几分钟（模型思考），回放时压到 1.6s 以内；太短也留 350ms 给人看清
    const delay = Math.min(1600, Math.max(350, gap || 700));
    const timer = window.setTimeout(() => {
      if (index + 1 >= frames.length) {
        setPlaying(false);
        return;
      }
      setIndex((value) => value + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, index, frames]);

  if (frames.length === 0) return null;

  const current = frames[Math.min(index, frames.length - 1)];
  const first = frames[0]?.time ?? 0;
  const elapsed = Math.max(0, (current?.time ?? first) - first);
  const total = Math.max(0, (frames[frames.length - 1]?.time ?? first) - first);
  const src = `${assetBase}${current.url}`;

  return (
    <div className="qa-keyframe">
      <div className="qa-keyframe-stage">
        <Image
          src={src}
          alt={current.label || `关键帧 ${index + 1}`}
          className="qa-keyframe-image"
          preview={{ mask: '查看大图' }}
        />
        {frames.length > 1 && (
          <button
            type="button"
            className="qa-keyframe-toggle"
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? '暂停回放' : '开始回放'}
          >
            {playing ? <PauseCircleFilled /> : <PlayCircleFilled />}
          </button>
        )}
        <span className="qa-keyframe-counter">
          {index + 1}/{frames.length}
        </span>
      </div>

      {frames.length > 1 && (
        <div className="qa-keyframe-controls">
          <Button
            type="text"
            size="small"
            icon={playing ? <PauseCircleFilled /> : <PlayCircleFilled />}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? '暂停' : '回放'}
          </Button>
          <input
            type="range"
            className="qa-keyframe-range"
            min={0}
            max={frames.length - 1}
            step={1}
            value={index}
            onChange={(event) => {
              setPlaying(false);
              setIndex(Number(event.target.value));
            }}
            aria-label="关键帧进度"
          />
          <span className="qa-keyframe-clock">
            {clock(elapsed)} / {clock(total)}
          </span>
        </div>
      )}

      <div className="qa-keyframe-thumbs">
        {frames.map((frame, frameIndex) => (
          <button
            type="button"
            key={`${frame.id}-${frameIndex}`}
            className={`qa-keyframe-thumb${frameIndex === index ? ' is-active' : ''}`}
            onClick={() => {
              setPlaying(false);
              setIndex(frameIndex);
            }}
            title={frame.label}
          >
            <img src={`${assetBase}${frame.url}`} alt={frame.label} loading="lazy" />
            <span>{frame.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
