import { Input, InputNumber, Select, Space, Typography } from 'antd';
import { t } from '../i18n';
import type { CaseStep, ProjectDataSource } from '../api/types';
import type { StepOption } from '../lib/caseYaml';

export default function CaptureFields({
  step,
  value,
  datasources,
  onChange,
}: {
  step: CaseStep;
  value: StepOption;
  datasources: ProjectDataSource[];
  onChange: (patch: Partial<StepOption>) => void;
}) {
  const text = (
    key: keyof StepOption,
    stepKey: keyof CaseStep,
    placeholder: string,
  ) => (
    <Input
      size="small"
      placeholder={placeholder}
      value={(value[key] as string | undefined) ?? (step[stepKey] as string | null) ?? ''}
      onChange={(event) => onChange({ [key]: event.target.value })}
    />
  );

  return (
    <Space direction="vertical" size={4} style={{ marginTop: 4, width: '100%' }}>
      <Input
        size="small"
        placeholder={t('变量名，例如 ORDER_NO')}
        value={value.name ?? step.name ?? ''}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('prompt / selector / sql 只能填一个；变量供依赖本用例的编排节点使用')}
      </Typography.Text>
      {text('prompt', 'prompt', t('页面取值描述（prompt）'))}
      {text('selector', 'selector', t('页面选择器（selector）'))}
      <Select
        size="small"
        allowClear
        placeholder={t('数据库数据源（可选）')}
        value={value.datasource ?? step.datasource ?? undefined}
        options={datasources.map((item) => ({
          value: item.name,
          label: `${item.name}（${item.dialect}）`,
        }))}
        onChange={(next) => onChange({ datasource: next ?? null })}
      />
      <Input.TextArea
        size="small"
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder={t('SQL（可选，只允许单条 SELECT/WITH）')}
        value={value.sql ?? step.sql ?? ''}
        onChange={(event) => onChange({ sql: event.target.value })}
      />
      <Space>
        <Input
          size="small"
          style={{ width: 220 }}
          placeholder={t('参数 JSON，例如 [1]')}
          value={
            value.params ??
            (Array.isArray(step.params) ? JSON.stringify(step.params) : '')
          }
          onChange={(event) => onChange({ params: event.target.value })}
        />
        <Input
          size="small"
          style={{ width: 140 }}
          placeholder={t('列名')}
          value={value.column ?? step.column ?? ''}
          onChange={(event) => onChange({ column: event.target.value })}
        />
        <InputNumber
          size="small"
          min={0}
          placeholder={t('行号')}
          value={value.row ?? step.row ?? undefined}
          onChange={(next) => onChange({ row: next ?? null })}
        />
      </Space>
      <Select
        size="small"
        allowClear
        style={{ width: 140 }}
        placeholder="as"
        value={value.as ?? step.as ?? undefined}
        options={[
          { value: 'string', label: 'string' },
          { value: 'number', label: 'number' },
          { value: 'boolean', label: 'boolean' },
        ]}
        onChange={(next) => onChange({ as: next ?? null })}
      />
    </Space>
  );
}