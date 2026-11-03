import { useState } from 'react';
import { App, Button, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCaseVersionDiff,
  getCaseVersions,
  rollbackCaseVersion,
} from '../api/caseVersions';
import { apiError } from '../api/client';
import { fmtDateTime } from '../lib/format';
import type { CaseVersion } from '../api/types';
import UnifiedDiff from './UnifiedDiff';
import { t } from '../i18n';

const SOURCE_LABEL: Record<CaseVersion['change_source'], string> = {
  create: '创建',
  manual: '手动保存',
  ai_fix: 'AI 修复',
  rollback: '回滚',
  backfill: '历史版本',
};

export default function CaseVersionsTab({ caseId }: { caseId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<CaseVersion | null>(null);
  const [diff, setDiff] = useState<{ title: string; text: string } | null>(null);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['case-versions', caseId],
    queryFn: () => getCaseVersions(caseId),
    enabled: Boolean(caseId),
  });

  const rollback = useMutation({
    mutationFn: (version: CaseVersion) => rollbackCaseVersion(caseId, version.id),
    onSuccess: () => {
      message.success(t('已回滚，并生成一条新版本记录'));
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      queryClient.invalidateQueries({ queryKey: ['case-versions', caseId] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  const compare = async (version: CaseVersion) => {
    try {
      const result = await getCaseVersionDiff(caseId, version.version_no);
      setDiff({
        title: t('v{from} → 当前（v{to}）', { from: result.from_version, to: result.to_version }),
        text: result.diff,
      });
    } catch (e) {
      message.error(apiError(e));
    }
  };

  return (
    <div>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        pagination={false}
        dataSource={versions}
        columns={[
          {
            title: t('版本'),
            dataIndex: 'version_no',
            width: 80,
            render: (value: number) => <Typography.Text strong>v{value}</Typography.Text>,
          },
          { title: t('名称'), dataIndex: 'name' },
          {
            title: t('来源'),
            dataIndex: 'change_source',
            width: 110,
            render: (value: CaseVersion['change_source']) => (
              <Tag color={value === 'ai_fix' ? 'purple' : value === 'rollback' ? 'orange' : 'default'}>
                {t(SOURCE_LABEL[value] ?? value)}
              </Tag>
            ),
          },
          {
            title: t('说明'),
            dataIndex: 'change_note',
            render: (value: string | null) => value || '-',
          },
          {
            title: t('时间'),
            dataIndex: 'created_at',
            render: (value: string) => fmtDateTime(value),
          },
          {
            title: t('操作'),
            width: 240,
            render: (_value, row) => (
              <Space>
                <Button size="small" onClick={() => setViewing(row)}>
                  {t('查看')}
                </Button>
                <Button size="small" onClick={() => compare(row)}>
                  {t('与当前对比')}
                </Button>
                <Popconfirm
                  title={t('回滚到 v{n}？', { n: row.version_no })}
                  description={t('会生成一条新版本，历史不会被删除。')}
                  onConfirm={() => rollback.mutate(row)}
                >
                  <Button size="small" danger loading={rollback.isPending}>
                    {t('回滚')}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={Boolean(viewing)}
        title={`v${viewing?.version_no ?? ''} · ${viewing?.name ?? ''}`}
        width={760}
        onCancel={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>{t('关闭')}</Button>}
      >
        <pre style={{ margin: 0, maxHeight: 520, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {viewing?.yaml_content}
        </pre>
      </Modal>

      <Modal
        open={Boolean(diff)}
        title={diff?.title}
        width={860}
        onCancel={() => setDiff(null)}
        footer={<Button onClick={() => setDiff(null)}>{t('关闭')}</Button>}
      >
        <UnifiedDiff diff={diff?.text ?? ''} />
      </Modal>
    </div>
  );
}
