import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Popconfirm, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QaTable from '../components/QaTable';
import { PageContainer } from '@ant-design/pro-components';
import { deleteUser, getUsers, updateUser } from '../api/users';
import { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import UserModal from '../components/UserModal';
import UserAvatar from '../components/UserAvatar';
import { PAGE, byNumber, byText } from '../lib/table';
import { t } from '../i18n';
import type { Role, User } from '../api/types';

const ROLE_LABEL: Record<Role, string> = { owner: '拥有者', admin: '管理员', member: '成员' };

export default function Users() {
  const { user: me, reload } = useAuth();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  // 与后端 require_people_admin 同一个口径：在任一团队里不是 member 就能维护人员
  const canMaintain = Boolean(me?.teams.some((team) => team.role !== 'member'));

  const { data: users = [], isLoading } = useQuery({
    // 与团队页那个不带团队的 ['users'] 分开缓存：同一个 key 两种形状会互相覆盖
    queryKey: ['users', 'with-teams'],
    queryFn: () => getUsers(true),
  });

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return users;
    return users.filter((u) =>
      [u.username, u.display_name, u.email].some((v) => (v ?? '').toLowerCase().includes(kw)),
    );
  }, [users, q]);

  const toggle = useMutation({
    mutationFn: (u: User) => updateUser(u.id, { is_active: !u.is_active }),
    onSuccess: (saved) => {
      message.success(saved.is_active ? t('账号已启用') : t('账号已停用，该用户将无法登录'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  // 物理删除：历史记录里的 created_by / 签名人会变成空，但记录本身还在
  const remove = useMutation({
    mutationFn: (u: User) => deleteUser(u.id),
    onSuccess: () => {
      message.success(t('账号已永久删除'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => message.error(apiError(e)),
  });

  function confirmDelete(target: User) {
    modal.confirm({
      title: t('永久删除「{name}」？', { name: target.username }),
      okText: t('删除'),
      okButtonProps: { danger: true },
      cancelText: t('取消'),
      content: (
        <div>
          <p style={{ marginTop: 8 }}>
            {t('这是')}<b>{t('物理删除')}</b>{t('，不可恢复：账号、它的团队关系都会消失；历史记录（谁建的用例、谁签的名）会变成「未知」，但记录本身保留。')}
          </p>
          <p style={{ marginBottom: 0 }}>{t('只是想让这个人不能登录，用「停用」就行。')}</p>
        </div>
      ),
      // 失败时 onError 已经弹了提示，这里吞掉 rejection：否则会是未处理的 Promise 错误
      onOk: () => remove.mutateAsync(target).catch(() => undefined),
    });
  }

  return (
    <PageContainer
      ghost
      header={{
        title: t('人员维护'),
        subTitle: t('人员是全局的：一个账号可以同时属于多个团队，在团队里加人就是从这份名单里挑'),
        extra: [
          <Input.Search
            key="search"
            allowClear
            placeholder={t('搜用户名 / 姓名 / 邮箱')}
            style={{ width: 240 }}
            onChange={(e) => setQ(e.target.value)}
          />,
          ...(canMaintain
            ? [
                <Button
                  key="create"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditing(null);
                    setOpen(true);
                  }}
                >
                  {t('新建人员')}
                </Button>,
              ]
            : []),
        ],
      }}
    >
      {!canMaintain && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('只有团队管理员能维护人员')}
          description={t('你当前在这些团队里都是普通成员，只能查看名单。新建、改资料、重置密码、停用需要 owner 或 admin。')}
        />
      )}

      <QaTable<User>
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        pagination={PAGE}
        columns={[
          {
            title: t('用户名'),
            dataIndex: 'username',
            sorter: byText<User>((r) => r.username),
            render: (_, r) => (
              <Space size={10}>
                <UserAvatar avatar={r.avatar} name={r.display_name || r.username} size={30} />
                <Space size={4}>
                  <span>{r.username}</span>
                  {r.id === me?.id && <Tag>{t('我')}</Tag>}
                </Space>
              </Space>
            ),
          },
          {
            title: t('姓名'),
            dataIndex: 'display_name',
            sorter: byText<User>((r) => r.display_name),
            render: (_, r) => r.display_name || <Typography.Text type="secondary">-</Typography.Text>,
          },
          {
            title: t('邮箱'),
            dataIndex: 'email',
            sorter: byText<User>((r) => r.email),
            render: (_, r) => r.email || <Typography.Text type="secondary">-</Typography.Text>,
          },
          {
            title: t('所属团队'),
            sorter: byNumber<User>((r) => r.teams?.length),
            render: (_, r) =>
              r.teams?.length ? (
                <Space size={4} wrap>
                  {r.teams.map((team) => (
                    <Tag key={team.id}>
                      {team.name}
                      {team.role !== 'member' && ` · ${t(ROLE_LABEL[team.role])}`}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              ),
          },
          {
            title: t('状态'),
            dataIndex: 'is_active',
            width: 90,
            sorter: byNumber<User>((r) => (r.is_active ? 1 : 0)),
            render: (_, r) => (r.is_active ? <Tag color="success">{t('启用')}</Tag> : <Tag>{t('已停用')}</Tag>),
          },
          {
            title: t('操作'),
            width: 210,
            render: (_, r) =>
              canMaintain ? (
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(r);
                      setOpen(true);
                    }}
                  >
                    {t('编辑')}
                  </Button>
                  <Popconfirm
                    title={r.is_active ? t('停用后该账号无法登录，确定？') : t('确定启用该账号？')}
                    onConfirm={() => toggle.mutate(r)}
                    disabled={r.id === me?.id}
                  >
                    <Button size="small" disabled={r.id === me?.id}>
                      {r.is_active ? t('停用') : t('启用')}
                    </Button>
                  </Popconfirm>
                  <Button
                    size="small"
                    danger
                    type="text"
                    disabled={r.id === me?.id}
                    onClick={() => confirmDelete(r)}
                  >
                    {t('删除')}
                  </Button>
                </Space>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              ),
          },
        ]}
      />

      <UserModal
        open={open}
        onClose={() => setOpen(false)}
        user={editing}
        onSaved={(saved) => {
          // 改了自己的头像/姓名，顶栏要跟着变
          if (saved.id === me?.id) void reload();
        }}
      />
    </PageContainer>
  );
}
