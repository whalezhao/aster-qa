import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { getIterationsByTeam, createIteration, deleteIteration, updateIteration } from '../../api/iterations';
import { apiError } from '../../api/client';
import { PAGE, byDate, byRank, byText } from '../../lib/table';
import { t } from '../../i18n';
import type {
  Iteration,
  IterationStatus } from '../../api/types';
import QaTable from '../../components/QaTable';
import { statusColors, statusLabels } from './shared';

export default function IterationsTab({ tid }: { tid: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Iteration | null>(null);
  const [form] = Form.useForm<IterationFormValues>();

  const { data: iterations = [], isLoading } = useQuery({
    queryKey: ['iterations', tid],
    queryFn: () => getIterationsByTeam(tid),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['iterations', tid] });

  const saveMutation = useMutation({
    mutationFn: (v: IterationFormValues) => {
      const payload = {
        name: v.name,
        version: v.version,
        status: v.status,
        start_date: v.start_date ? v.start_date.format('YYYY-MM-DD') : undefined,
        end_date: v.end_date ? v.end_date.format('YYYY-MM-DD') : undefined,
      };
      return editing ? updateIteration(editing.id, payload) : createIteration(tid, payload);
    },
    onSuccess: () => {
      message.success(editing ? t('迭代已更新') : t('迭代已创建'));
      setOpen(false);
      invalidate();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteIteration(id),
    onSuccess: () => {
      message.success(t('迭代已删除'));
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
          form.setFieldsValue({ status: 'planned' });
          setOpen(true);
        }}
      >
        {t('新建迭代')}
      </Button>
      <QaTable<Iteration>
        rowKey="id"
        loading={isLoading}
        dataSource={iterations}
        pagination={PAGE}
        columns={[
          {
            title: t('名称'),
            dataIndex: 'name',
            sorter: byText<Iteration>((r) => r.name),
          },
          {
            title: t('版本'),
            dataIndex: 'version',
            sorter: byText<Iteration>((r) => r.version),
            render: (v: string | null) => v || '-',
          },
          {
            title: t('状态'),
            dataIndex: 'status',
            sorter: byRank<Iteration>((r) => r.status, ['planned', 'active', 'released', 'archived']),
            render: (s: IterationStatus) => <Tag color={statusColors[s]}>{t(statusLabels[s])}</Tag>,
          },
          {
            title: t('开始'),
            dataIndex: 'start_date',
            sorter: byDate<Iteration>((r) => r.start_date),
            render: (v: string | null) => v || '-',
          },
          {
            title: t('结束'),
            dataIndex: 'end_date',
            sorter: byDate<Iteration>((r) => r.end_date),
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
                      version: r.version ?? undefined,
                      status: r.status,
                      start_date: r.start_date ? dayjs(r.start_date) : null,
                      end_date: r.end_date ? dayjs(r.end_date) : null,
                    });
                    setOpen(true);
                  }}
                >
                  {t('编辑')}
                </Button>
                <Popconfirm title={t('确定删除该迭代？')} onConfirm={() => deleteMutation.mutate(r.id)}>
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
        title={editing ? t('编辑迭代') : t('新建迭代')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} preserve={false}>
          <Form.Item name="name" label={t('名称')} rules={[{ required: true, message: t('请输入迭代名称') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="version" label={t('版本')}>
            <Input placeholder={t('如 v1.2.0')} />
          </Form.Item>
          <Form.Item name="status" label={t('状态')} rules={[{ required: true }]}>
            <Select
              options={(Object.keys(statusLabels) as IterationStatus[]).map((s) => ({
                value: s,
                label: t(statusLabels[s]),
              }))}
            />
          </Form.Item>
          <Form.Item name="start_date" label={t('开始日期')}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="end_date" label={t('结束日期')}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

interface IterationFormValues {
  name: string;
  version?: string;
  status: IterationStatus;
  start_date?: Dayjs | null;
  end_date?: Dayjs | null;
}

