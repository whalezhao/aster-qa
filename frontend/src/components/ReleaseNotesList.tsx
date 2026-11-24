import { Empty, Space, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { t } from '../i18n';
import type { ReleaseCategory, ReleaseNote } from '../releaseNotes';

const CATEGORY: Record<ReleaseCategory, { label: string; color: string }> = {
  feature: { label: '新功能', color: 'blue' },
  improvement: { label: '优化', color: 'green' },
  fix: { label: '修复', color: 'orange' },
};

export default function ReleaseNotesList({ notes }: { notes: ReleaseNote[] }) {
  if (notes.length === 0) return <Empty description={t('暂无版本公告')} />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {notes.map((note) => (
        <ProCard
          key={note.version}
          title={`v${note.version}`}
          extra={<Typography.Text type="secondary">{note.date}</Typography.Text>}
        >
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            {note.items.map((item, index) => (
              <div key={`${note.version}-${index}`}>
                <Space size={8} wrap>
                  <Tag color={CATEGORY[item.category].color} style={{ marginInlineEnd: 0 }}>
                    {t(CATEGORY[item.category].label)}
                  </Tag>
                  <Typography.Text strong>{item.title}</Typography.Text>
                </Space>
                <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                  {item.description}
                </Typography.Paragraph>
              </div>
            ))}
          </Space>
        </ProCard>
      ))}
    </Space>
  );
}