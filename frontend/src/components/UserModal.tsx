import { useEffect, useState } from 'react';
import { App, Form, Input, Modal, Space, theme, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createUser, updateUser } from '../api/users';
import { apiError } from '../api/client';
import UserAvatar, { AVATAR_PRESETS, AvatarFigure } from './UserAvatar';
import type { User } from '../api/types';

interface FormValues {
  username: string;
  display_name?: string;
  email?: string;
  password?: string;
}

/**
 * 新建 / 编辑人员。新建和编辑的差异只有两处：编辑时用户名不可改、密码留空表示不改。
 * 加团队成员时也用这个弹窗直接把人建出来 —— 只给一个「选已有用户」的下拉，
 * 新人就永远进不来。
 *
 * 头像是内置的卡通脸（不做上传）：选一个 key 存库，前端按 key 画 SVG。
 */
export default function UserModal({
  open,
  onClose,
  user,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** 传了就是编辑，不传是新建 */
  user?: User | null;
  onSaved?: (u: User) => void;
}) {
  const editing = Boolean(user);
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setAvatar(user?.avatar ?? null);
    if (user) {
      form.setFieldsValue({
        username: user.username,
        display_name: user.display_name ?? undefined,
        email: user.email ?? undefined,
      });
    }
  }, [open, user, form]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      // 空串在 email 上是有毒的：那一列有唯一约束，两个「不填邮箱」的人会撞车
      const email = v.email?.trim() || undefined;
      const displayName = v.display_name?.trim() || undefined;
      if (!user) {
        return createUser({
          username: v.username.trim(),
          password: v.password as string,
          email,
          display_name: displayName,
          avatar,
        });
      }
      return updateUser(user.id, {
        email: email ?? null,
        display_name: displayName ?? null,
        avatar,
        password: v.password || undefined,
      });
    },
    onSuccess: (saved) => {
      message.success(editing ? '资料已更新' : `人员「${saved.username}」已创建`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
      onSaved?.(saved);
    },
    onError: (e) => message.error(apiError(e)),
  });

  return (
    <Modal
      title={user ? `编辑人员：${user.username}` : '新建人员'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      forceRender
      width={520}
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} preserve={false}>
        <Form.Item label="头像">
          <Space size={8} wrap>
            <button
              type="button"
              onClick={() => setAvatar(null)}
              style={{
                width: 46,
                height: 46,
                borderRadius: 10,
                cursor: 'pointer',
                background: 'transparent',
                border: `2px solid ${avatar === null ? token.colorPrimary : token.colorBorderSecondary}`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="不用卡通头像（显示首字母）"
            >
              <UserAvatar name={form.getFieldValue('username') || user?.username} size={36} />
            </button>
            {AVATAR_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => setAvatar(preset.key)}
                style={{
                  padding: 0,
                  border: `2px solid ${avatar === preset.key ? token.colorPrimary : 'transparent'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: 'transparent',
                  lineHeight: 0,
                }}
                title={preset.key}
              >
                <AvatarFigure preset={preset} size={42} />
              </button>
            ))}
          </Space>
        </Form.Item>

        <Form.Item
          name="username"
          label="用户名（登录用）"
          rules={
            editing
              ? []
              : [
                  { required: true, message: '请输入用户名' },
                  { min: 2, message: '至少 2 个字符' },
                ]
          }
        >
          <Input disabled={editing} autoComplete="off" />
        </Form.Item>
        <Form.Item name="display_name" label="姓名">
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          label={editing ? '重置密码（留空则不修改）' : '初始密码'}
          rules={
            editing
              ? [{ min: 6, message: '至少 6 位' }]
              : [
                  { required: true, message: '请设置初始密码' },
                  { min: 6, message: '至少 6 位' },
                ]
          }
        >
          <Input.Password autoComplete="new-password" placeholder={editing ? '留空则不改' : '至少 6 位'} />
        </Form.Item>
      </Form>
      {!editing && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
          建完可以在团队页把它加进团队。
        </Typography.Paragraph>
      )}
    </Modal>
  );
}
