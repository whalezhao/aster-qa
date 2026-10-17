import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Popconfirm, Space, Tag, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { getProjects, createProject, deleteProject, updateProject } from '../../api/projects';
import { apiError } from '../../api/client';
import { PAGE, byNumber, byText } from '../../lib/table';
import type {
  Project } from '../../api/types';
import QaTable from '../../components/QaTable';

export default function ProjectsTab({ tid }: { tid: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form] = Form.useForm<ProjectFormValues>();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', tid],
    queryFn: () => getProjects(tid),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects', tid] });

  const saveMutation = useMutation({
    mutationFn: (v: ProjectFormValues) =>
      editing ? updateProject(editing.id, v) : createProject(tid, { ...v, name: v.name }),
    onSuccess: () => {
      message.success(editing ? '项目已更新' : '项目已创建');
      setOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      message.success('项目已删除');
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

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
        新建项目
      </Button>
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
            render: (name: string, r) => <Link to={`/projects/${r.id}`}>{name}</Link>,
          },
          {
            title: '编码',
            dataIndex: 'code',
            sorter: byText<Project>((r) => r.code),
            render: (v: string | null) => v || '-',
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
            sorter: byText<Project>((r) => r.base_url),
            render: (v: string | null) => v || '-',
          },
          {
            title: '描述',
            dataIndex: 'description',
            sorter: byText<Project>((r) => r.description),
            render: (v: string | null) => v || '-',
          },
          {
            title: '操作',
            width: 160,
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue({
                      name: r.name,
                      code: r.code ?? undefined,
                      description: r.description ?? undefined,
                      base_url: r.base_url ?? undefined,
                    });
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Popconfirm title="确定删除该项目？" onConfirm={() => deleteMutation.mutate(r.id)}>
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑项目' : '新建项目'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="编码">
            <Input />
          </Form.Item>
          <Form.Item name="base_url" label="Base URL">
            <Input placeholder="https://example.com" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

interface ProjectFormValues {
  name: string;
  code?: string;
  description?: string;
  base_url?: string;
}

