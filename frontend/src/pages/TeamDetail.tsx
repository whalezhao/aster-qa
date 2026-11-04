import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { getTeam } from '../api/teams';
import { getLocale, t } from '../i18n';

import MembersTab from './team/MembersTab';
import ProjectsTab from './team/ProjectsTab';
import IterationsTab from './team/IterationsTab';
import TagsTab from './team/TagsTab';
import WebhooksTab from './team/WebhooksTab';
import ApiTokensTab from './team/ApiTokensTab';

// 页签用复数，正文里的「系统」等是单数表头
const tab = (zh: string, en: string) => (getLocale() === 'en' ? en : zh);

export default function TeamDetail() {
  const { tid = '' } = useParams();
  const { data: team } = useQuery({ queryKey: ['team', tid], queryFn: () => getTeam(tid) });

  return (
    <ProCard
      style={{ margin: 20 }}
      title={team ? team.name : t('测试团队')}
      extra={<Link to="/teams">{t('返回测试团队列表')}</Link>}
    >
      {team?.description && (
        <ProDescriptions column={1} style={{ marginBottom: 16 }}>
          <ProDescriptions.Item label={t('描述')}>{team.description}</ProDescriptions.Item>
        </ProDescriptions>
      )}
      <Tabs
        items={[
          { key: 'members', label: tab('成员', 'Members'), children: <MembersTab tid={tid} /> },
          { key: 'projects', label: tab('系统', 'Projects'), children: <ProjectsTab tid={tid} /> },
          { key: 'iterations', label: tab('迭代', 'Iterations'), children: <IterationsTab tid={tid} /> },
          { key: 'tags', label: tab('标签', 'Tags'), children: <TagsTab tid={tid} /> },
          { key: 'webhooks', label: 'Webhook', children: <WebhooksTab tid={tid} /> },
          { key: 'tokens', label: 'API Token', children: <ApiTokensTab tid={tid} /> },
        ]}
      />
    </ProCard>
  );
}
