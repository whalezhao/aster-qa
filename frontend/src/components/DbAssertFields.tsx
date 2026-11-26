import { Input, InputNumber, Select, Space, Switch, Typography } from 'antd';
import type { ProjectDataSource } from '../api/types';
import { t } from '../i18n';
import type { Step, StepOption } from '../lib/caseYaml';

interface Props {
  step: Step;
  value: StepOption;
  datasources: ProjectDataSource[];
  onChange: (patch: Partial<StepOption>) => void;
}

function datasourceOptions(datasources: ProjectDataSource[]) {
  const environments = new Map<string, string[]>();
  for (const item of datasources) {
    const names = environments.get(item.name) ?? [];
    if (!names.includes(item.environment_name)) names.push(item.environment_name);
    environments.set(item.name, names);
  }
  return Array.from(environments.entries()).map(([name, envs]) => ({
    value: name,
    label: `${name}（${envs.join(' / ')}）`,
  }));
}

export default function DbAssertFields({
  step,
  value,
  datasources,
  onChange,
}: Props) {
  const params =
    value.params !== undefined
      ? value.params
      : Array.isArray(step.params)
        ? JSON.stringify(step.params)
        : '';
  return (
    <Space direction="vertical" size={4} style={{ marginTop: 4, width: '100%' }}>
      {datasources.length === 0 && (
        <Typography.Text type="warning" style={{ fontSize: 11 }}>
          {t('当前项目未配置数据库，请先到 环境 → 数据库 添加数据源。')}
        </Typography.Text>
      )}
      <Space size={6} wrap>
        <Select
          size="small"
          style={{ width: 210 }}
          placeholder={t('数据源')}
          options={datasourceOptions(datasources)}
          value={value.datasource ?? step.datasource ?? undefined}
          onChange={(datasource) => onChange({ datasource })}
        />
        <Select
          size="small"
          style={{ width: 110 }}
          value={value.as ?? step.as ?? 'string'}
          onChange={(as) => onChange({ as })}
          options={[
            { value: 'string', label: t('字符串') },
            { value: 'number', label: t('数字') },
            { value: 'boolean', label: t('布尔') },
          ]}
        />
        {(value.as ?? step.as ?? 'string') === 'number' && (
          <InputNumber
            size="small"
            min={0}
            step={0.01}
            style={{ width: 120 }}
            placeholder={t('容差')}
            value={value.tolerance ?? step.tolerance ?? undefined}
            onChange={(tolerance) => onChange({ tolerance })}
          />
        )}
      </Space>
      <Input
        size="small"
        placeholder={t('页面取值描述（prompt），与选择器二选一')}
        value={value.prompt ?? step.prompt ?? step.text ?? ''}
        onChange={(event) => onChange({ prompt: event.target.value, selector: '' })}
      />
      <Input
        size="small"
        placeholder={t('CSS 选择器（selector），与 prompt 二选一')}
        value={value.selector ?? step.selector ?? ''}
        onChange={(event) => onChange({ selector: event.target.value, prompt: '' })}
      />
      <Input.TextArea
        size="small"
        rows={3}
        placeholder={t('单条 SELECT / WITH 查询，动态值用 ? 占位')}
        value={value.sql ?? step.sql ?? ''}
        onChange={(event) => onChange({ sql: event.target.value })}
      />
      <Input
        size="small"
        placeholder={t('参数（JSON 数组，可选），例如 ["${ORDER_NO}"]')}
        value={params}
        onChange={(event) => onChange({ params: event.target.value })}
      />
      <Space size={6} wrap>
        <Input
          size="small"
          style={{ width: 170 }}
          placeholder={t('列名（单列可省略）')}
          value={value.column ?? step.column ?? ''}
          onChange={(event) => onChange({ column: event.target.value })}
        />
        <InputNumber
          size="small"
          min={0}
          style={{ width: 100 }}
          placeholder={t('行号')}
          value={value.row ?? step.row ?? undefined}
          onChange={(row) => onChange({ row })}
        />
        <span style={{ fontSize: 11 }}>
          {t('忽略大小写')}{' '}
          <Switch
            size="small"
            checked={value.ignoreCase ?? step.ignoreCase ?? false}
            onChange={(ignoreCase) => onChange({ ignoreCase })}
          />
        </span>
        <InputNumber
          size="small"
          min={1000}
          max={600000}
          step={1000}
          style={{ width: 140 }}
          placeholder={t('超时 ms')}
          value={value.timeoutMs ?? step.timeoutMs ?? undefined}
          onChange={(timeoutMs) => onChange({ timeoutMs })}
        />
      </Space>
      <Input
        size="small"
        placeholder={t('失败提示（可选）')}
        value={value.message ?? step.message ?? ''}
        onChange={(event) => onChange({ message: event.target.value })}
      />
    </Space>
  );
}