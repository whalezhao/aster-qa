import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Space, Tooltip, Typography, theme } from 'antd';
import {
  AudioMutedOutlined,
  AudioOutlined,
  CloseOutlined,
  ReloadOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { getBatches } from '../api/batches';
import { getStatsOverview } from '../api/stats';
import { useActiveTeam } from '../team/TeamContext';
import Logo, { type LogoMood } from './Logo';
import { canSpeak, speak, stopSpeaking } from '../lib/speak';
import { t } from '../i18n';
import { useLocale } from '../i18n/LocaleContext';

interface Line {
  text: string;
  mood: LogoMood;
}

const VOICE_KEY = 'qa_agent_voice';
const ROTATE_MS = 7000;
const AUTO_OPEN_MS = 1500;
const AUTO_CLOSE_MS = 10000;

function voiceEnabled(): boolean {
  return localStorage.getItem(VOICE_KEY) !== '0';
}

/** 把测试团队当前的数据翻译成几句人话 —— 不调模型，本地即时生成。 */
function buildLines(
  overview: Awaited<ReturnType<typeof getStatsOverview>> | undefined,
  batches: Awaited<ReturnType<typeof getBatches>> | undefined,
): Line[] {
  const lines: Line[] = [];
  const items = batches?.items ?? [];
  const running = items.filter((b) => b.status === 'running').length;
  const latest = items[0];

  if (running > 0) {
    lines.push({ text: t('有 {n} 次执行正在跑，我盯着，跑完给你结论。', { n: running }), mood: 'thinking' });
  }
  if (latest && ['completed_with_failures', 'partial', 'failed'].includes(latest.status)) {
    lines.push({
      text: t('最近一次「{name}」有 {n} 条失败，点进执行记录能看到我的逐条诊断。', {
        name: latest.name,
        n: latest.failed,
      }),
      mood: 'alert',
    });
  }
  if (overview) {
    const n = overview.sample_size ?? 0;
    const rate = overview.final_pass_rate;
    if (rate != null) {
      const pct = Math.round(rate * 100);
      if (n < 3) {
        lines.push({ text: t('最近只有 {n} 个用例样本，先别急着下结论，多跑几次更准。', { n }), mood: 'thinking' });
      } else if (rate >= 0.9) {
        lines.push({ text: t('最近通过率 {pct}%，{n} 个用例，状态不错，继续保持。', { pct, n }), mood: 'happy' });
      } else if (rate >= 0.7) {
        lines.push({ text: t('最近通过率 {pct}%，有点波动，建议看看失败排行和 flaky 榜单。', { pct }), mood: 'idle' });
      } else {
        lines.push({ text: t('最近通过率只有 {pct}%，我们得看看是哪出了问题。', { pct }), mood: 'alert' });
      }
    }
    if ((overview.excluded_infra_runs ?? 0) > 0) {
      lines.push({
        text: t('有 {n} 次执行是模型额度或网络问题，没计入通过率，别当成产品缺陷。', {
          n: overview.excluded_infra_runs,
        }),
        mood: 'thinking',
      });
    }
  }
  if (lines.length === 0) {
    lines.push({ text: t('这个测试团队还没有执行记录，先跑一次回归，我就能告诉你情况了。'), mood: 'idle' });
  }
  lines.push({ text: t('我可以帮你写用例、看执行结果、做测试团队复盘。点我就能听我说。'), mood: 'happy' });
  return lines;
}

/**
 * 顶栏上的 AI 小助手：logo + 会冒出的话。
 *
 * 「说话」= 气泡文字 + 浏览器朗读（用户点击后才出声 —— 浏览器不允许自动播报）。
 * 内容不调模型，直接读当前测试团队的统计和执行记录，所以是即时的、不用等。
 */
export default function AgentPresence({ size = 42 }: { size?: number }) {
  const { teamId } = useActiveTeam();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [voice, setVoice] = useState(voiceEnabled);
  const closeTimer = useRef<number | null>(null);

  const { data: overview } = useQuery({
    // key 与工作台保持一致，命中同一份缓存 —— 顶栏常驻，不该每页再请求一遍
    queryKey: ['stats-overview', teamId],
    queryFn: () => getStatsOverview({ team_id: teamId ?? undefined }),
    enabled: Boolean(teamId),
    staleTime: 60_000,
  });
  const { data: batches } = useQuery({
    queryKey: ['batches', { team_id: teamId, limit: 5 }],
    queryFn: () => getBatches({ team_id: teamId ?? undefined, limit: 5 }),
    enabled: Boolean(teamId),
    staleTime: 30_000,
  });

  const { locale } = useLocale();
  const lines = useMemo(() => buildLines(overview, batches), [overview, batches, locale]);
  const line = lines[index % lines.length];
  const running = (batches?.items ?? []).filter((b) => b.status === 'running').length;

  // 每个会话第一次进来，自己冒个泡（不出声 —— 还没用户手势）
  useEffect(() => {
    if (!teamId || sessionStorage.getItem('qa_agent_greeted')) return;
    const timer = window.setTimeout(() => {
      sessionStorage.setItem('qa_agent_greeted', '1');
      setOpen(true);
      closeTimer.current = window.setTimeout(() => setOpen(false), AUTO_CLOSE_MS);
    }, AUTO_OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [teamId]);

  // 打开时轮换消息
  useEffect(() => {
    if (!open || lines.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % lines.length), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [open, lines.length]);

  useEffect(() => () => stopSpeaking(), []);

  const say = (text: string) => {
    if (!canSpeak() || !voice) return;
    speak(text);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) say(line.text);
    else stopSpeaking();
  };

  const nextLine = () => {
    const value = (index + 1) % lines.length;
    setIndex(value);
    say(lines[value].text);
  };

  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    localStorage.setItem(VOICE_KEY, next ? '1' : '0');
    if (!next) stopSpeaking();
    else say(line.text);
  };

  return (
    <div className="qa-agent">
      <button
        type="button"
        className="qa-agent-trigger"
        onClick={toggle}
        aria-label={t('AI 助手，点击听一句话')}
        aria-expanded={open}
      >
        <Logo
          size={size}
          mood={running > 0 ? 'thinking' : line.mood}
        />
        {running > 0 && <span className="qa-agent-pulse" aria-hidden />}
      </button>

      {open && (
        <div
          className="qa-agent-bubble"
          role="status"
          style={{
            background: token.colorBgElevated,
            border: `1px solid ${token.colorBorderSecondary}`,
            boxShadow: token.boxShadowSecondary,
          }}
        >
          <span
            className="qa-agent-tail"
            style={{ background: token.colorBgElevated }}
            aria-hidden
          />
          <div className="qa-agent-head">
            <span
              className="qa-agent-dot"
              style={{ background: running > 0 ? '#22B07D' : token.colorPrimary }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11, letterSpacing: 0.2 }}>
              {t('AI 助手')} ·{' '}
              {running > 0
                ? t('正在盯 {count} 个执行', { count: running })
                : t('实时读取测试团队数据')}
            </Typography.Text>
          </div>
          <Typography.Text style={{ fontSize: 13, lineHeight: 1.7 }}>{line.text}</Typography.Text>
          <div className="qa-agent-actions" style={{ borderTop: `1px solid ${token.colorSplit}` }}>
            <Space size={2}>
              <Tooltip title={voice ? t('静音') : t('开声音')}>
                <Button
                  size="small"
                  type="text"
                  icon={voice ? <AudioOutlined /> : <AudioMutedOutlined />}
                  onClick={toggleVoice}
                  style={{ opacity: voice ? 1 : 0.45 }}
                />
              </Tooltip>
              <Tooltip title={t('念一遍')}>
                <Button size="small" type="text" icon={<SoundOutlined />} onClick={() => say(line.text)} />
              </Tooltip>
              <Tooltip title={t('换一句')}>
                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={nextLine} />
              </Tooltip>
            </Space>
            <Tooltip title={t('收起')}>
              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => {
                  setOpen(false);
                  stopSpeaking();
                }}
              />
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}
