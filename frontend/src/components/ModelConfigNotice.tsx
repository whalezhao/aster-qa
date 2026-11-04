import { useQuery } from '@tanstack/react-query';
import { Alert, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { getModelConfig } from '../api/projects';
import { t } from '../i18n';

/**
 * 「这个系统还没配好大模型」的提示条。
 *
 * 平台没有全局模型兜底：模型名 / 接入地址 / API Key 必须由系统自己指定，
 * 三项不齐就不允许执行。所以用例编辑页、功能详情页、触发执行处都要给用户
 * 一个明确的出口，而不是让大家在点执行时才撞上 400。
 *
 * 系统已配好时不渲染任何东西。
 */
export default function ModelConfigNotice({
  projectId,
  action = '执行',
}: {
  projectId: string | null | undefined;
  /** 这里是要做什么动作，用来把话说明白，例如「执行」/「保存并执行」 */
  action?: string;
}) {
  const { data } = useQuery({
    queryKey: ['model-config', projectId],
    queryFn: () => getModelConfig(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });

  if (!projectId || !data || data.configured) return null;

  const missing = data.missing.join(t('、'));
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message={t('该系统还没配好大模型，无法{action}', { action: t(action) })}
      description={
        <Space direction="vertical" size={4}>
          <Typography.Text>
            {t('缺少：')}<Typography.Text strong>{missing}</Typography.Text>
          </Typography.Text>
          <Typography.Text type="secondary">
            {t('平台不提供全局模型，每个系统必须自己指定模型。')}
            {t('到')} <Link to={`/projects/${projectId}`}>{t('系统详情 → 大模型配置')}</Link>
            {t('补齐后即可{action}。', { action: t(action) })}
          </Typography.Text>
        </Space>
      }
    />
  );
}
