import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Space, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ModalForm, PageContainer, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import { Link } from 'react-router-dom';
import { createProject, getProjects, type ProjectInput } from '../api/projects';
import { apiError } from '../api/client';
import { useActiveTeam } from '../team/TeamContext';
import QaTable from '../components/QaTable';
import { PAGE, byNumber, byText } from '../lib/table';
import type { Project } from '../api/types';

/**
 * 项目入口。之前只能「团队 → 项目 tab」才能点到项目，路径太深；
 * 团队切换在顶栏，所以这里直接展示当前团队的项目。
 */
export default function Projects() {
  const { message } = App.useApp();
  const { teamId } = useActiveTeam();
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => getProjects(teamId as string),
    enabled: Boolean(teamId),
  });

  const create = useMutation({
    mutationFn: (values: ProjectInput) =>
      createProject(teamId as string, { ...values, name: values.name! }),
    onSuccess: (saved) => {
      message.success(`项目「${saved.name}」已创建`);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <PageContainer
      ghost
      header={{
        title: '项目',
        subTitle: '功能、用例和模型配置都在项目里；顶栏可以切换团队',
        extra: [
          <ModalForm<ProjectInput>
            key="create"
            title="新建项目"
            trigger={
              <Button type="primary" icon={<PlusOutlined />}>
                新建项目
              </Button>
            }
            modalProps={{ destroyOnHidden: true }}
            onFinish={async (values) => {
              await create.mutateAsync(values);
              return true;
            }}
          >
            <ProFormText name="name" label="名称" rules={[{ required: true, message: '请输入项目名称' }]} />
            <ProFormText name="code" label="编码" placeholder="可留空，例如 pansoft-demo" />
            <ProFormText
              name="base_url"
              label="被测地址（Base URL）"
              placeholder="用例里的 ${BASE_URL} 会替换成它"
            />
            <ProFormTextArea name="description" label="描述" fieldProps={{ rows: 2 }} />
          </ModalForm>,
        ],
      }}
    >
      <QaTable<Project>
        rowKey="id"
        loading={isLoading}
        dataSource={projects}
        pagination={PAGE}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            sorter: byText<Project>((r) => r.name),
            render: (_, r) => <Link to={`/projects/${r.id}`}>{r.name}</Link>,
          },
          {
            title: '编码',
            dataIndex: 'code',
            sorter: byText<Project>((r) => r.code),
            render: (_, r) => r.code || <Typography.Text type="secondary">-</Typography.Text>,
          },
          {
            title: '大模型',
            width: 150,
            sorter: byNumber<Project>((r) => (r.has_model_config ? 1 : 0)),
            render: (_, r) => (
              <Space direction="vertical" size={2}>
                {r.has_model_config ? (
                  <Tag color="success">已配置</Tag>
                ) : (
                  // 没配模型的项目跑不了任何用例，列表里要一眼能扫出来
                  <Link to={`/projects/${r.id}`}>
                    <Tag color="warning">未配置</Tag>
                  </Link>
                )}
                {r.model_health && (
                  <Tooltip title={r.model_health.message}>
                    <Tag
                      color={
                        r.model_health.status === 'healthy'
                          ? 'green'
                          : r.model_health.status === 'unhealthy'
                            ? 'red'
                            : 'default'
                      }
                    >
                      {r.model_health.status === 'healthy'
                        ? '模型正常'
                        : r.model_health.status === 'unhealthy'
                          ? '模型异常'
                          : '未检测'}
                    </Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          {
            title: 'Base URL',
            dataIndex: 'base_url',
            render: (_, r) => r.base_url || <Typography.Text type="secondary">-</Typography.Text>,
          },
          {
            title: '描述',
            dataIndex: 'description',
            render: (_, r) =>
              r.description || <Typography.Text type="secondary">-</Typography.Text>,
          },
          {
            title: '操作',
            width: 100,
            render: (_, r) => (
              <Space>
                <Link to={`/projects/${r.id}`}>
                  <Button size="small">进入</Button>
                </Link>
              </Space>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
