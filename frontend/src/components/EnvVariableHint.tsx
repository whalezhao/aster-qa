import type { CSSProperties } from 'react';
import { Collapse, Space, Tag, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getProjectEnvironments } from '../api/environments';
import { t } from '../i18n';

/** 环境变量速查：告诉写用例的人 YAML 里能用哪些变量、怎么引用。
 *
 * 只展示变量名，不展示值 —— 值可能是账号口令，写用例时也用不着看见。
 */
export default function EnvVariableHint({
  projectId,
  style,
}: {
  projectId?: string | null;
  style?: CSSProperties;
}) {
  const { token } = theme.useToken();
  const { data: environments = [] } = useQuery({
    queryKey: ['project-environments', projectId],
    queryFn: () => getProjectEnvironments(projectId as string),
    enabled: Boolean(projectId),
  });

  const code = (text: string) => (
    <Typography.Text code style={{ fontSize: 12 }}>
      {text}
    </Typography.Text>
  );

  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'env-vars',
          label: t('环境变量怎么用（不同环境跑不同数据）'),
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text style={{ fontSize: 12 }}>
                {t('普通变量写')} {code('${KEY}')}{t('，密钥写')} {code('${{KEY}}')}
                {t('。执行时按「执行环境」注入，同一份 YAML 换个环境就是另一套数据；密钥不会写进 YAML 和报告。')}
              </Typography.Text>
              <Typography.Text style={{ fontSize: 12 }}>
                {t('被测地址不用写死，')} {code('${BASE_URL}')} {t('由所选环境自动注入。')}
              </Typography.Text>
              {environments.length > 0 && (
                <Space wrap size={4}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('各环境可用变量：')}
                  </Typography.Text>
                  {environments.map((env) => (
                    <Tag key={env.id} style={{ marginInlineEnd: 4 }}>
                      {env.name}{t('：')}
                      {env.variables.length === 0
                        ? t('无')
                        : env.variables.map((variable) => (
                            <span key={variable.id}>
                              {variable.is_secret
                                ? '${{' + variable.key + '}}'
                                : '${' + variable.key + '}'}
                              {variable.is_secret ? t('（密钥）') : ''}
                              {variable !== env.variables[env.variables.length - 1] ? t('、') : ''}
                            </span>
                          ))}
                    </Tag>
                  ))}
                </Space>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('想让登录账号、搜索词、测试数据随环境变化，就把它们配成系统环境变量，用例里只写变量名 —— 别把值写死在 YAML 里。')}
              </Typography.Text>
            </Space>
          ),
        },
      ]}
      // 折叠区背景跟页面保持一致，别在深色模式下留一块白
      expandIconPosition="end"
      bordered={false}
      style={{ background: token.colorFillQuaternary, borderRadius: 8, ...style }}
    />
  );
}
