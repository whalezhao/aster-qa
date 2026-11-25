import { Fragment } from 'react';
import {
  Button,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import type { RunDetail } from '../api/types';
import { t } from '../i18n';
import { stepKindLabel, yamlRows, type Step, type StepOption } from '../lib/caseYaml';

const STEP_COLORS = [
  '#7dd3fc',
  '#c4b5fd',
  '#fbbf24',
  '#6ee7b7',
  '#fda4af',
  '#67e8f9',
  '#fdba74',
  '#bef264',
];

interface Props {
  yaml: string;
  steps: Step[];
  options: Record<string, StepOption>;
  onOptionChange: (key: string, option: StepOption) => void;
  trial?: RunDetail | null;
  trialBusy?: boolean;
  onTrial?: (caseIndex: number, stepLimit: number) => void;
  /** 目录跳转后高亮的 key（case-{i} / step-{i}-{j}） */
  highlightKey?: string;
}

/** 步骤 / YAML 逐行对照面板。表头和内容共用同一个 CSS grid，列宽不会错位。 */
export default function StepYamlPanel({
  yaml,
  steps,
  options,
  onOptionChange,
  trial,
  trialBusy = false,
  onTrial,
  highlightKey,
}: Props) {
  const { token } = theme.useToken();
  const rows = yamlRows(yaml, steps);
  const results = new Map(
    (trial?.step_results ?? []).map((item) => [
      `${item.case_index}:${item.step}`,
      item,
    ]),
  );
  const grid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.15fr) 18px minmax(0, 1fr)',
    alignItems: 'stretch',
  };

  const set = (step: Step, patch: Partial<StepOption>) => {
    const key = `${step.case_index}:${step.index}`;
    onOptionChange(key, { ...(options[key] ?? {}), ...patch });
  };

  return (
    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ maxHeight: 620, overflowY: 'auto' }}>
        <div style={grid}>
          {[
            t('步骤'),
            '',
            t('YAML'),
          ].map((label, index) => (
            <div
              key={`head-${index}`}
              style={{
                padding: '8px 12px',
                fontSize: 12,
                color: token.colorTextSecondary,
                background: token.colorFillQuaternary,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              {label}
            </div>
          ))}
          {rows.map((row, index) => {
            const step = row.step;
            const tone = step ? STEP_COLORS[step.case_index % STEP_COLORS.length] : undefined;
            const key = step ? `${step.case_index}:${step.index}` : '';
            const result = step ? results.get(key) : undefined;
            const opt = step ? (options[key] ?? {}) : {};
            const stepKey = step ? `step-${step.case_index}-${step.index}` : '';
            const caseKey =
              row.caseName && row.caseIndex !== undefined ? `case-${row.caseIndex}` : '';
            const active = Boolean(
              highlightKey &&
                ((stepKey && highlightKey === stepKey) ||
                  (caseKey && highlightKey === caseKey)),
            );
            return (
              <Fragment key={`${index}-${key}`}>
                <div
                  id={caseKey || undefined}
                  style={{
                    padding: 6,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    background: active ? token.colorWarningBg : undefined,
                    borderRadius: active ? 8 : undefined,
                    transition: 'background 0.3s',
                  }}
                >
                  {step ? (
                    <div
                      id={stepKey || undefined}
                      style={{
                        border: `1px solid ${tone ?? token.colorBorderSecondary}`,
                        borderLeft: `3px solid ${tone ?? token.colorBorderSecondary}`,
                        borderRadius: 8,
                        background: active ? token.colorWarningBg : token.colorFillQuaternary,
                        padding: '6px 8px',
                      }}
                    >
                      {row.caseName && (
                        <Tag color="processing" style={{ marginInlineEnd: 6 }}>
                          {t('用例 {n}：{name}', {
                            n: (row.caseIndex ?? 0) + 1,
                            name: row.caseName,
                          })}
                        </Tag>
                      )}
                      <Typography.Text strong style={{ fontSize: 12 }}>
                        {stepKindLabel(step.kind)}
                      </Typography.Text>
                      <Typography.Text style={{ fontSize: 12, marginLeft: 6 }}>
                        {step.text}
                      </Typography.Text>

                      <div style={{ marginTop: 4 }}>
                        {result ? (
                          <Tooltip title={result.reason || result.status}>
                            <Tag
                              color={
                                ['success', 'passed'].includes(result.status)
                                  ? 'success'
                                  : 'error'
                              }
                              icon={
                                ['success', 'passed'].includes(result.status) ? (
                                  <CheckCircleOutlined />
                                ) : (
                                  <CloseCircleOutlined />
                                )
                              }
                            >
                              {['success', 'passed'].includes(result.status)
                                ? t('通过')
                                : t('失败')}
                            </Tag>
                          </Tooltip>
                        ) : null}
                        {onTrial && (
                          <Button
                            size="small"
                            type="link"
                            icon={<PlayCircleOutlined />}
                            loading={trialBusy}
                            onClick={() => onTrial(step.case_index, step.index + 1)}
                          >
                            {t('试跑到这里')}
                          </Button>
                        )}
                      </div>

                      <StepOptions step={step} value={opt} onChange={(patch) => set(step, patch)} />
                    </div>
                  ) : row.caseName ? (
                    <Tag color="processing">
                      {t('用例 {n}：{name}', {
                        n: (row.caseIndex ?? 0) + 1,
                        name: row.caseName,
                      })}
                    </Tag>
                  ) : null}
                </div>

                <div
                  style={{
                    position: 'relative',
                    borderLeft: `1px solid ${tone ?? token.colorBorderSecondary}`,
                    margin: '6px 0',
                  }}
                >
                  {(opt.cache === true || opt.deep === true) && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: '50%',
                        width: 18,
                        height: 8,
                        borderTop: `1px ${opt.deep ? 'dashed' : 'solid'} ${
                          tone ?? token.colorBorderSecondary
                        }`,
                        borderRight: `1px ${opt.deep ? 'dashed' : 'solid'} ${
                          tone ?? token.colorBorderSecondary
                        }`,
                        borderTopRightRadius: 8,
                      }}
                    />
                  )}
                </div>

                <div
                  style={{
                    padding: '6px 8px',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 12,
                    lineHeight: '20px',
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                  }}
                >
                  {row.lines.map((line) => (
                    <div key={line.no} style={{ display: 'flex', gap: 8 }}>
                      <span
                        style={{
                          color: token.colorTextQuaternary,
                          width: 28,
                          textAlign: 'right',
                          flex: '0 0 auto',
                          userSelect: 'none',
                        }}
                      >
                        {line.no}
                      </span>
                      <span>{line.text || ' '}</span>
                    </div>
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepOptions({
  step,
  value,
  onChange,
}: {
  step: Step;
  value: StepOption;
  onChange: (patch: Partial<StepOption>) => void;
}) {
  if (!['aiAct', 'aiWaitFor', 'aiAssert', 'upload', 'download'].includes(step.kind)) {
    return null;
  }
  if (step.kind === 'upload') {
    const filesValue =
      value.files ??
      value.file ??
      (step.files?.length ? step.files.join(', ') : (step.file ?? ''));
    return (
      <Space direction="vertical" size={2} style={{ marginTop: 4, width: '100%' }}>
        <Input
          size="small"
          placeholder={t('上传动作描述（prompt）')}
          value={value.prompt ?? step.prompt ?? step.text}
          onChange={(event) => onChange({ prompt: event.target.value })}
        />
        <Input
          size="small"
          placeholder={t('文件 key，多个用逗号分隔')}
          value={filesValue}
          onChange={(event) => onChange({ files: event.target.value, file: undefined })}
        />
      </Space>
    );
  }
  if (step.kind === 'download') {
    return (
      <Space direction="vertical" size={2} style={{ marginTop: 4, width: '100%' }}>
        <Input
          size="small"
          placeholder={t('触发下载的动作（trigger）')}
          value={value.trigger ?? step.trigger ?? step.text}
          onChange={(event) => onChange({ trigger: event.target.value })}
        />
        <Space size={6} wrap>
          <Input
            size="small"
            style={{ width: 190 }}
            placeholder={t('期望文件名（可选）')}
            value={value.filename ?? step.filename ?? ''}
            onChange={(event) => onChange({ filename: event.target.value })}
          />
          <InputNumber
            size="small"
            min={0}
            style={{ width: 120 }}
            placeholder={t('最小字节')}
            value={value.minBytes ?? step.minBytes ?? undefined}
            onChange={(minBytes) => onChange({ minBytes })}
          />
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
          <Input
            size="small"
            style={{ width: 190 }}
            placeholder={t('保存文件名（可选）')}
            value={value.saveAs ?? step.saveAs ?? ''}
            onChange={(event) => onChange({ saveAs: event.target.value })}
          />
        </Space>
      </Space>
    );
  }
  return (
    <Space direction="vertical" size={2} style={{ marginTop: 4, width: '100%' }}>
      {step.kind === 'aiAct' && (
        <Space size={8} wrap>
          <span style={{ fontSize: 11 }}>
            {t('缓存')}{' '}
            <Switch
              size="small"
              checked={value.cache ?? step.cacheable ?? false}
              onChange={(checked) => onChange({ cache: checked })}
            />
          </span>
          <span style={{ fontSize: 11 }}>
            {t('深度定位')}{' '}
            <Switch
              size="small"
              checked={value.deep ?? step.deepLocate ?? false}
              onChange={(checked) => onChange({ deep: checked })}
            />
          </span>
          <Select
            size="small"
            style={{ width: 96 }}
            value={value.effort ?? step.effort ?? 'balance'}
            options={[
              { value: 'fast', label: 'fast' },
              { value: 'balance', label: 'balance' },
              { value: 'deepThink', label: 'deepThink' },
            ]}
            onChange={(effort) => onChange({ effort })}
          />
        </Space>
      )}
      {step.kind === 'aiWaitFor' && (
        <InputNumber
          size="small"
          min={1000}
          max={600000}
          step={1000}
          style={{ width: 140 }}
          placeholder={t('超时 ms（默认 15000）')}
          value={value.timeoutMs ?? step.timeoutMs ?? undefined}
          onChange={(timeoutMs) => onChange({ timeoutMs })}
        />
      )}
      {step.kind === 'aiAssert' && (
        <Input
          size="small"
          placeholder={t('失败文案（可选）')}
          value={value.message ?? step.message ?? ''}
          onChange={(event) => onChange({ message: event.target.value })}
        />
      )}
      <Input
        size="small"
        placeholder={t('单步上下文 / 额外约束（可选）')}
        value={value.context ?? step.context ?? ''}
        onChange={(event) => onChange({ context: event.target.value })}
      />
    </Space>
  );
}