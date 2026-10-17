import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Popconfirm, Space, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ModalForm, PageContainer, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import { createTeam, deleteTeam, getTeams, updateTeam, type TeamInput } from '../api/teams';
import { apiError } from '../api/client';
import { PAGE, byText } from '../lib/table';
import type { Team } from '../api/types';
import QaTable from '../components/QaTable';

export default function Teams() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);

  const { data: teams = [], isLoading } = useQuery({ queryKey: ['teams'], queryFn: getTeams });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['teams'] });

  const saveMutation = useMutation({
    mutationFn: (values: TeamInput) =>
      editing ? updateTeam(editing.id, values) : createTeam({ ...values, name: values.name! }),
    onSuccess: () => {
      message.success(editing ? '团队已更新' : '团队已创建');
      setOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => {
      message.success('团队已删除');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(team: Team) {
    setEditing(team);
    setOpen(true);
  }

  return (
    <PageContainer
      ghost
      header={{
        title: '团队',
        subTitle: '删除团队需要拥有者（owner）权限',
        extra: [
          <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建团队
          </Button>,
        ],
      }}
    >
      <QaTable<Team>
        rowKey="id"
        loading={isLoading}
        dataSource={teams}
        pagination={PAGE}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            sorter: byText<Team>((r) => r.name),
            render: (_, record) => <Link to={`/teams/${record.id}`}>{record.name}</Link>,
          },
          {
            title: '描述',
            dataIndex: 'description',
            sorter: byText<Team>((r) => r.description),
            render: (_, record) =>
              record.description || <Typography.Text type="secondary">-</Typography.Text>,
          },
          {
            title: '操作',
            width: 160,
            render: (_, record) => (
              <Space>
                <Button size="small" onClick={() => openEdit(record)}>
                  编辑
                </Button>
                <Popconfirm
                  title="确定删除该团队？"
                  description="删除后不可恢复。"
                  onConfirm={() => deleteMutation.mutate(record.id)}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <ModalForm<TeamInput>
        title={editing ? '编辑团队' : '新建团队'}
        open={open}
        onOpenChange={setOpen}
        modalProps={{ destroyOnHidden: true }}
        initialValues={
          editing ? { name: editing.name, description: editing.description ?? undefined } : undefined
        }
        onFinish={async (values) => {
          await saveMutation.mutateAsync(values);
          return true;
        }}
      >
        <ProFormText
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入团队名称' }]}
        />
        <ProFormTextArea name="description" label="描述" fieldProps={{ rows: 3 }} />
      </ModalForm>
    </PageContainer>
  );
}
