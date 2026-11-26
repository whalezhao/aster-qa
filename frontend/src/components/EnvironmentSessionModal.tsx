import { useEffect, useState } from 'react';
import {
  App,
  Button,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProjectCases } from '../api/cases';
import { getFeatures } from '../api/features';
import {
  clearEnvironmentSessionState,
  getEnvironmentSessionConfig,
  setEnvironmentSessionConfig,
} from '../api/session';
import { apiError } from '../api/client';
import { t } from '../i18n';
import { fmtDateTime } from '../lib/format';
import type { CaseOption, Environment, Feature } from '../api/types';

function CaseSelect({
  value,
  onChange,
  features,
  cases,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  features: Feature[];
  cases: CaseOption[];
  placeholder: string;
}) {
  const [featureId, setFeatureId] = useState<string | null>(null);
  const selected = cases.find((item) => item.id === value);
  const effectiveFeatureId = featureId ?? selected?.feature_id ?? null;

  useEffect(() => {
    if (selected && selected.feature_id !== featureId) {
      setFeatureId(selected.feature_id);
    }
  }, [selected, featureId]);

  const caseOptions = cases
    .filter((item) => item.feature_id === effectiveFeatureId)
    .map((item) => ({
      value: item.id,
      label: `${item.name}${item.priority ? ` · ${item.priority}` : ''}`,
    }));

  return (
    <Space wrap>
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        style={{ width: 220 }}
        placeholder={t('选择功能')}
        value={effectiveFeatureId ?? undefined}
        options={features.map((feature) => ({
          value: feature.id,
          label: feature.name,
        }))}
        onChange={(next) => {
          setFeatureId(next ?? null);
          onChange(null);
        }}
      />
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        style={{ width: 260 }}
        placeholder={placeholder}
        value={value ?? undefined}
        options={
          selected && !caseOptions.some((option) => option.value === value)
            ? [...caseOptions, { value, label: selected.name }]
            : caseOptions
        }
        onChange={(next) => onChange(next ?? null)}
        disabled={!effectiveFeatureId}
      />
    </Space>
  );
}

export default function EnvironmentSessionModal({
  env,
  onClose,
}: {
  env: Environment | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [loginCaseId, setLoginCaseId] = useState<string | null>(null);
  const [checkCaseId, setCheckCaseId] = useState<string | null>(null);
  const [ttlMinutes, setTtlMinutes] = useState(30);
  const [retryOnExpiry, setRetryOnExpiry] = useState(true);

  const projectId = env?.project_id ?? '';
  const { data: config } = useQuery({
    queryKey: ['environment-session', env?.id],
    queryFn: () => getEnvironmentSessionConfig(env!.id),
    enabled: Boolean(env),
  });
  const { data: features = [] } = useQuery({
    queryKey: ['features', projectId],
    queryFn: () => getFeatures(projectId),
    enabled: Boolean(projectId),
  });
  const { data: cases = [] } = useQuery({
    queryKey: ['project-cases', projectId],
    queryFn: () => getProjectCases(projectId),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setLoginCaseId(config.login_case_id);
    setCheckCaseId(config.check_case_id);
    setTtlMinutes(Math.max(1, Math.round(config.ttl_seconds / 60)));
    setRetryOnExpiry(config.retry_on_expiry);
  }, [config]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['environment-session', env?.id] });
    queryClient.invalidateQueries({ queryKey: ['environments', projectId] });
  };

  const save = useMutation({
    mutationFn: () => {
      if (enabled && !loginCaseId) throw t('请选择登录会话用例');
      return setEnvironmentSessionConfig(env!.id, {
        enabled,
        login_case_id: loginCaseId,
        check_case_id: checkCaseId,
        ttl_seconds: Math.max(60, Math.min(86400, Math.round(ttlMinutes * 60))),
        retry_on_expiry: retryOnExpiry,
      });
    },
    onSuccess: () => {
      message.success(t('登录会话配置已保存'));
      refresh();
    },
    onError: (error) => message.error(apiError(error)),
  });

  const clear = useMutation({
    mutationFn: () => clearEnvironmentSessionState(env!.id),
    onSuccess: () => {
      message.success(t('会话缓存已清除'));
      refresh();
    },
    onError: (error) => message.error(apiError(error)),
  });

  return (
    <Modal
      open={Boolean(env)}
      title={env ? t('登录会话 · {name}', { name: env.name }) : t('登录会话')}
      width={820}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{t('关闭')}</Button>
          <Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('保存会话配置')}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <span>{t('启用登录会话保持')}</span>
          <Switch checked={enabled} onChange={setEnabled} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('仅对当前环境生效；主用例执行前优先复用该环境的浏览器会话。')}
          </Typography.Text>
        </Space>

        <Space wrap>
          <Typography.Text style={{ width: 88 }}>{t('登录用例')}</Typography.Text>
          <CaseSelect
            value={loginCaseId}
            onChange={setLoginCaseId}
            features={features}
            cases={cases}
            placeholder={t('选择登录用例')}
          />
        </Space>

        <Space wrap>
          <Typography.Text style={{ width: 88 }}>{t('检查用例')}</Typography.Text>
          <CaseSelect
            value={checkCaseId}
            onChange={setCheckCaseId}
            features={features}
            cases={cases}
            placeholder={t('可选：登录后检查')}
          />
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('可选。执行前先用缓存访问一个登录后页面，失败则刷新登录。')}
        </Typography.Text>

        <Space wrap>
          <Typography.Text>{t('缓存有效期')}</Typography.Text>
          <InputNumber
            min={1}
            max={1440}
            value={ttlMinutes}
            onChange={(value) => setTtlMinutes(Number(value ?? 30))}
            addonAfter={t('分钟')}
          />
          <span>{t('会话过期自动重试')}</span>
          <Switch checked={retryOnExpiry} onChange={setRetryOnExpiry} />
        </Space>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('登录用例应是单 case YAML；它不会参与普通用例的通过率统计。')}
        </Typography.Text>

        <Table
          size="small"
          rowKey="environment_id"
          pagination={false}
          tableLayout="fixed"
          dataSource={config?.states ?? []}
          locale={{ emptyText: t('还没有环境会话缓存') }}
          columns={[
            {
              title: t('最近刷新'),
              dataIndex: 'refreshed_at',
              width: 140,
              render: (value: string | null) => fmtDateTime(value),
            },
            {
              title: t('最近使用'),
              dataIndex: 'last_used_at',
              width: 140,
              render: (value: string | null) => fmtDateTime(value),
            },
            {
              title: t('状态'),
              dataIndex: 'last_error',
              render: (value: string | null) =>
                value ? (
                  <Typography.Text
                    type="danger"
                    style={{
                      display: 'block',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {value}
                  </Typography.Text>
                ) : (
                  <Tag color="success">{t('正常')}</Tag>
                ),
            },
            {
              title: t('操作'),
              width: 110,
              render: () => (
                <Button
                  size="small"
                  danger
                  loading={clear.isPending}
                  onClick={() => clear.mutate()}
                >
                  {t('清除缓存')}
                </Button>
              ),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}