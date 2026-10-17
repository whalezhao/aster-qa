import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'antd';
import { ProCard, ProDescriptions } from '@ant-design/pro-components';
import { getTeam } from '../api/teams';

import MembersTab from './team/MembersTab';
import ProjectsTab from './team/ProjectsTab';
import IterationsTab from './team/IterationsTab';
import TagsTab from './team/TagsTab';
import WebhooksTab from './team/WebhooksTab';
import ApiTokensTab from './team/ApiTokensTab';

export default function TeamDetail() {
  const { tid = '' } = useParams();
  const { data: team } = useQuery({ queryKey: ['team', tid], queryFn: () => getTeam(tid) });

  return (
    <ProCard
      style={{ margin: 20 }}
      title={team ? team.name : '团队'}
      extra={<Link to="/teams">返回团队列表</Link>}
    >
      {team?.description && (
        <ProDescriptions column={1} style={{ marginBottom: 16 }}>
          <ProDescriptions.Item label="描述">{team.description}</ProDescriptions.Item>
        </ProDescriptions>
      )}
      <Tabs
        items={[
          { key: 'members', label: '成员', children: <MembersTab tid={tid} /> },
          { key: 'projects', label: '项目', children: <ProjectsTab tid={tid} /> },
          { key: 'iterations', label: '迭代', children: <IterationsTab tid={tid} /> },
          { key: 'tags', label: '标签', children: <TagsTab tid={tid} /> },
          { key: 'webhooks', label: 'Webhook', children: <WebhooksTab tid={tid} /> },
          { key: 'tokens', label: 'API Token', children: <ApiTokensTab tid={tid} /> },
        ]}
      />
    </ProCard>
  );
}
