import { Alert, Card, Space, Tag, Typography, theme } from 'antd';
import AiMascot, { type MascotState } from './AiMascot';
import SpeakButton from './SpeakButton';
import { fmtDateTime } from '../lib/format';
import type { AiCheckResult } from '../api/types';
import { t } from '../i18n';

const VERDICT: Record<string, { color: string; label: string; mascot: MascotState }> = {
  healthy: { color: 'success', label: '健康', mascot: 'happy' },
  risky: { color: 'warning', label: '有风险', mascot: 'thinking' },
  needs_attention: { color: 'error', label: '需要关注', mascot: 'alert' },
  unknown: { color: 'default', label: '未判定', mascot: 'idle' },
};

/** 逐条诊断里的责任归属：这条失败该修谁。 */
const OWNER: Record<string, { color: string; label: string }> = {
  case: { color: 'blue', label: '改用例' },
  product: { color: 'red', label: '疑似产品缺陷' },
  env: { color: 'default', label: '环境/数据' },
};

/**
 * AI 结论卡片：执行结果评估和签名前预检共用。
 *
 * 只是建议 —— 卡片里没有「不允许继续」这种按钮，签名/执行照常可以进行。
 */
export default function AiInsightCard({
  title = 'AI 评估',
  check,
  pendingText = 'AI 正在评估这次结果…',
  emptyText = '这次执行完成后会自动生成 AI 评估',
  extra,
}: {
  title?: string;
  check: AiCheckResult | undefined;
  pendingText?: string;
  emptyText?: string;
  extra?: React.ReactNode;
}) {
  const { token } = theme.useToken();

  if (!check || check.status === 'none' || check.status === 'pending') {
    const pending = check?.status === 'pending';
    return (
      <Card className="qa-ai-card" style={{ background: token.colorFillQuaternary }}>
        <Space size={12} align="center">
          <AiMascot size={48} state={pending ? 'thinking' : 'idle'} />
          <Typography.Text type="secondary">
            {pending ? t(pendingText) : t(emptyText)}
          </Typography.Text>
        </Space>
      </Card>
    );
  }

  if (check.status === 'failed') {
    return (
      <Alert
        type="info"
        showIcon
        message={t('{title}暂不可用', { title: t(title) })}
        description={check.error || t('AI 调用失败')}
      />
    );
  }

  const view = VERDICT[check.verdict ?? 'unknown'] ?? VERDICT.unknown;
  const speech = [check.summary, ...(check.reasons || []), ...(check.advice || [])]
    .filter(Boolean)
    .join('。');

  return (
    <Card
      className="qa-ai-card"
      title={
        <Space size={10}>
          <AiMascot size={24} state={view.mascot} />
          <span>{t(title)}</span>
          <Tag color={view.color}>{t(view.label)}</Tag>
        </Space>
      }
      extra={
        <Space>
          {extra}
          <SpeakButton text={speech} />
        </Space>
      }
    >
      {check.summary && (
        <Typography.Paragraph style={{ fontSize: 15, marginBottom: 12 }}>
          {check.summary}
        </Typography.Paragraph>
      )}

      {(check.reasons?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text strong>{t('发现')}</Typography.Text>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {check.reasons.map((reason, index) => (
              <li key={index}>
                <Typography.Text>{reason}</Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(check.diagnoses?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text strong>{t('逐条诊断')}</Typography.Text>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {check.diagnoses!.map((d, index) => (
              <li key={index} style={{ marginBottom: 8 }}>
                <Space size={6} wrap>
                  {d.case && <Typography.Text strong>{d.case}</Typography.Text>}
                  {d.owner && (
                    <Tag color={OWNER[d.owner]?.color}>
                      {t(OWNER[d.owner]?.label ?? d.owner)}
                    </Tag>
                  )}
                </Space>
                {d.cause && (
                  <div>
                    <Typography.Text>{d.cause}</Typography.Text>
                  </div>
                )}
                {d.action && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('建议：')}{d.action}
                  </Typography.Text>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(check.advice?.length ?? 0) > 0 && (
        <div>
          <Typography.Text strong>{t('建议')}</Typography.Text>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {check.advice.map((item, index) => (
              <li key={index}>
                <Typography.Text type="secondary">{item}</Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        {check.model_name ? `${t('由 {model} 生成', { model: check.model_name })} · ` : ''}
        {check.created_at ? fmtDateTime(check.created_at) : ''} · {t('仅供参考，不影响流程')}
      </Typography.Paragraph>
    </Card>
  );
}
