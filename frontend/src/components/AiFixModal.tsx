import { useEffect, useState } from 'react';
import { Alert, App, Button, Collapse, Modal, Space, Spin, Tag, Typography } from 'antd';
import XMarkdown from '@ant-design/x-markdown';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { aiFixCase, updateCase } from '../api/cases';
import { apiError } from '../api/client';
import type { AiFixResult } from '../api/types';
import UnifiedDiff from './UnifiedDiff';

interface Props {
  open: boolean;
  caseId: string;
  caseName?: string;
  onClose: () => void;
}

/** AI 修复建议：只展示 diff，必须人工点「应用并保存」才落库。 */
export default function AiFixModal({ open, caseId, caseName, onClose }: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<AiFixResult | null>(null);

  const generate = useMutation({
    mutationFn: () => aiFixCase(caseId),
    onSuccess: setResult,
    onError: (e: unknown) => message.error(apiError(e)),
  });

  useEffect(() => {
    if (!open) {
      setResult(null);
      return;
    }
    setResult(null);
    generate.mutate();
    // 只在打开/换用例时触发，generate 本身不做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseId]);

  const apply = useMutation({
    mutationFn: () =>
      updateCase(caseId, {
        yaml_content: result?.proposed_yaml,
        change_source: 'ai_fix',
        change_note: 'AI 根据失败记录修复',
      }),
    onSuccess: () => {
      message.success('已保存为新的用例版本');
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-versions', caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-history', caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      onClose();
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <Modal
      open={open}
      title={`AI 修复用例${caseName ? ` · ${caseName}` : ''}`}
      width={820}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button onClick={() => generate.mutate()} loading={generate.isPending}>
            重新生成
          </Button>
          <Button
            type="primary"
            disabled={!result?.yaml_ok || !result?.diff || apply.isPending}
            loading={apply.isPending}
            onClick={() => apply.mutate()}
          >
            应用并保存
          </Button>
        </Space>
      }
    >
      {generate.isPending && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
          <div style={{ marginTop: 12 }}>
            <Typography.Text type="secondary">
              正在读取失败步骤并让模型生成修复建议…
            </Typography.Text>
          </div>
        </div>
      )}
      {generate.isError && (
        <Alert
          type="error"
          showIcon
          message="生成失败"
          description={apiError(generate.error)}
        />
      )}
      {result && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Tag color="processing">模型：{result.model_name ?? '-'}</Tag>
            <Tag color={result.yaml_ok ? 'success' : 'error'}>
              YAML {result.yaml_ok ? '校验通过' : '校验未通过'}
            </Tag>
          </Space>
          <Alert
            type="info"
            showIcon
            message="AI 建议"
            description={<XMarkdown content={result.explanation} />}
          />
          <UnifiedDiff diff={result.diff} />
          {!result.diff && (
            <Alert
              type="info"
              showIcon
              message="AI 没有修改用例"
              description="这次失败更像是环境或产品问题；建议先修复环境或提交缺陷，而不是硬改用例。"
            />
          )}
          <Collapse
            items={[
              {
                key: 'yaml',
                label: '查看建议后的完整 YAML',
                children: (
                  <pre
                    style={{
                      margin: 0,
                      maxHeight: 300,
                      overflow: 'auto',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {result.proposed_yaml}
                  </pre>
                ),
              },
            ]}
          />
          {!result.yaml_ok && (
            <Alert
              type="warning"
              showIcon
              message="该建议没有通过 YAML 校验，不能直接应用"
              description={result.yaml_errors.join('；')}
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
