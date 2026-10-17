import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Modal, Popconfirm, Select } from 'antd';
import { PlusOutlined, UserAddOutlined } from '@ant-design/icons';
import { addMember, getMembers, removeMember, updateMemberRole } from '../../api/teams';
import { getUsers } from '../../api/users';
import { apiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import UserModal from '../../components/UserModal';
import { PAGE, byRank, byText } from '../../lib/table';
import type {
  Role,
  TeamMember } from '../../api/types';
import QaTable from '../../components/QaTable';
import { roleOptions } from './shared';

export default function MembersTab({ tid }: { tid: string }) {
  const { message } = App.useApp();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // 新人常是「还没账号」的状态 —— 只给一个选人下拉，人永远加不进来
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ user_id: string; role: Role }>();
  const canMaintain = Boolean(me?.teams.some((t) => t.role !== 'member'));

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members', tid],
    queryFn: () => getMembers(tid),
  });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getUsers() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['members', tid] });
    queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  const addMutation = useMutation({
    mutationFn: (v: { user_id: string; role: Role }) => addMember(tid, v.user_id, v.role),
    onSuccess: () => {
      message.success('成员已添加');
      setOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const roleMutation = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => updateMemberRole(tid, v.userId, v.role),
    onSuccess: () => {
      message.success('角色已更新');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(tid, userId),
    onSuccess: () => {
      message.success('成员已移除');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const memberIds = new Set(members.map((m) => m.user_id));
  const candidates = users.filter((u) => !memberIds.has(u.id));

  return (
    <div>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => {
          form.resetFields();
          setOpen(true);
        }}
        style={{ marginBottom: 16 }}
      >
        添加成员
      </Button>
      <QaTable<TeamMember>
        rowKey="user_id"
        loading={isLoading}
        dataSource={members}
        pagination={PAGE}
        columns={[
          {
            title: '用户名',
            sorter: byText<TeamMember>((m) => m.user.username),
            render: (_, m) => m.user.username,
          },
          {
            title: '显示名',
            sorter: byText<TeamMember>((m) => m.user.display_name),
            render: (_, m) => m.user.display_name || '-',
          },
          {
            title: '角色',
            width: 160,
            sorter: byRank<TeamMember>((m) => m.role, ['member', 'admin', 'owner']),
            render: (_, m) => (
              <Select
                size="small"
                style={{ width: 120 }}
                value={m.role}
                options={roleOptions}
                onChange={(role) => roleMutation.mutate({ userId: m.user_id, role })}
              />
            ),
          },
          {
            title: '操作',
            width: 100,
            render: (_, m) => (
              <Popconfirm title="确定移除该成员？" onConfirm={() => removeMutation.mutate(m.user_id)}>
                <Button size="small" danger>
                  移除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal
        title="添加成员"
        open={open}
        onCancel={() => setOpen(false)}
        confirmLoading={addMutation.isPending}
        forceRender
        footer={[
          canMaintain ? (
            <Button key="new" icon={<UserAddOutlined />} onClick={() => setCreateOpen(true)}>
              新建人员
            </Button>
          ) : null,
          <Button key="cancel" onClick={() => setOpen(false)}>
            取消
          </Button>,
          <Button key="ok" type="primary" loading={addMutation.isPending} onClick={() => form.submit()}>
            确定
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={(v) => addMutation.mutate(v)} preserve={false}>
          <Form.Item name="user_id" label="用户" rules={[{ required: true, message: '请选择用户' }]}>
            <Select
              showSearch
              placeholder="按用户名搜索"
              optionFilterProp="label"
              options={candidates.map((u) => ({ value: u.id, label: `${u.display_name || u.username}（${u.username}）` }))}
            />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="member" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 建完直接选上，不用退出这个弹窗再去下拉里找人 */}
      <UserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(u) => form.setFieldValue('user_id', u.id)}
      />
    </div>
  );
}