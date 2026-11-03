import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { getIterationsByTeam } from '../../api/iterations';
import { getTagsByTeam, createTag, deleteTag, updateTag } from '../../api/tags';
import { apiError } from '../../api/client';
import { PAGE, byText } from '../../lib/table';
import { t } from '../../i18n';
import type {
  Tag as TagType } from '../../api/types';
import QaTable from '../../components/QaTable';
import { colorPresets } from './shared';

export default function TagsTab({ tid }: { tid: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TagType | null>(null);
  const [form] = Form.useForm<TagFormValues>();

  const { data: tags = [], isLoading } = useQuery({ queryKey: ['tags', tid], queryFn: () => getTagsByTeam(tid) });
  const { data: iterations = [] } = useQuery({
    queryKey: ['iterations', tid],
    queryFn: () => getIterationsByTeam(tid),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tags', tid] });

  const saveMutation = useMutation({
    mutationFn: (v: TagFormValues) =>
      editing ? updateTag(editing.id, v) : createTag(tid, { ...v, name: v.name }),
    onSuccess: () => {
      message.success(editing ? t('标签已更新') : t('标签已创建'));
      setOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => {
      message.success(t('标签已删除'));
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const iterationName = (id: string | null) => iterations.find((i) => i.id === id)?.name;

  return (
    <div>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        style={{ marginBottom: 16 }}
        onClick={() => {
          setEditing(null);
          form.resetFields();
          setOpen(true);
        }}
      >
        {t('新建标签')}
      </Button>
      <QaTable<TagType>
        rowKey="id"
        loading={isLoading}
        dataSource={tags}
        pagination={PAGE}
        columns={[
          {
            title: t('名称'),
            dataIndex: 'name',
            sorter: byText<TagType>((r) => r.name),
            render: (name: string, r) => <Tag color={r.color ?? undefined}>{name}</Tag>,
          },
          {
            title: t('所属迭代'),
            sorter: byText<TagType>((r) => iterationName(r.iteration_id)),
            render: (_, r) => (r.iteration_id ? iterationName(r.iteration_id) ?? r.iteration_id : '-'),
          },
          {
            title: t('颜色'),
            dataIndex: 'color',
            sorter: byText<TagType>((r) => r.color),
            render: (v: string | null) => v || '-',
          },
          {
            title: t('描述'),
            dataIndex: 'description',
            sorter: byText<TagType>((r) => r.description),
            render: (v: string | null) => v || '-',
          },
          {
            title: t('操作'),
            width: 160,
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue({
                      name: r.name,
                      color: r.color ?? undefined,
                      iteration_id: r.iteration_id,
                      description: r.description ?? undefined,
                    });
                    setOpen(true);
                  }}
                >
                  {t('编辑')}
                </Button>
                <Popconfirm title={t('确定删除该标签？')} onConfirm={() => deleteMutation.mutate(r.id)}>
                  <Button size="small" danger>
                    {t('删除')}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? t('编辑标签') : t('新建标签')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} preserve={false}>
          <Form.Item name="name" label={t('名称')} rules={[{ required: true, message: t('请输入标签名称') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="iteration_id" label={t('所属迭代')}>
            <Select
              allowClear
              placeholder={t('可不选')}
              options={iterations.map((i) => ({ value: i.id, label: i.name }))}
            />
          </Form.Item>
          <Form.Item name="color" label={t('颜色')}>
            <Select
              allowClear
              placeholder={t('选择预设色')}
              options={colorPresets.map((c) => ({
                value: c,
                label: (
                  <Space>
                    <span style={{ display: 'inline-block', width: 12, height: 12, background: c, borderRadius: 2 }} />
                    {c}
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label={t('描述')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

interface TagFormValues {
  name: string;
  color?: string;
  iteration_id?: string | null;
  description?: string;
}
