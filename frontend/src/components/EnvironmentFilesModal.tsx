import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteEnvironmentFile,
  downloadEnvironmentFile,
  getEnvironmentFiles,
  uploadEnvironmentFile,
} from '../api/files';
import { apiError } from '../api/client';
import { t } from '../i18n';
import type { Environment, ProjectFile } from '../api/types';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PAGE_SIZE = 10;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadValues {
  key: string;
  description?: string;
  replace?: boolean;
}

export default function EnvironmentFilesModal({
  env,
  onClose,
}: {
  env: Environment | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<UploadValues>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  useEffect(() => {
    setPage(1);
  }, [env?.id]);

  const { data, isLoading } = useQuery({
    queryKey: ['environment-files', env?.id, page, pageSize],
    queryFn: () =>
      getEnvironmentFiles(env!.id, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    enabled: Boolean(env),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['environment-files', env?.id] });
  };

  const upload = useMutation({
    mutationFn: (values: UploadValues) => {
      const raw = fileList[0]?.originFileObj as File | undefined;
      if (!raw) throw t('请选择文件');
      return uploadEnvironmentFile(env!.id, {
        key: values.key.trim(),
        file: raw,
        description: values.description,
        replace: values.replace,
      });
    },
    onSuccess: () => {
      message.success(t('文件已上传'));
      setUploadOpen(false);
      setPage(1);
      form.resetFields();
      setFileList([]);
      refresh();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEnvironmentFile(env!.id, id),
    onSuccess: () => {
      message.success(t('文件已删除'));
      // 删掉当前页最后一个文件时回到上一页，避免停在空页
      if (page > 1 && (data?.items.length ?? 0) === 1) setPage(page - 1);
      refresh();
    },
    onError: (e) => message.error(apiError(e)),
  });

  const download = useMutation({
    mutationFn: (row: ProjectFile) => downloadEnvironmentFile(env!.id, row),
    onError: (e) => message.error(apiError(e)),
  });

  const openUpload = () => {
    form.resetFields();
    setFileList([]);
    setUploadOpen(true);
  };

  return (
    <>
      <Modal
        open={Boolean(env)}
        title={t('测试文件 · {name}', { name: env?.name ?? '' })}
        width={1000}
        onCancel={onClose}
        footer={<Button onClick={onClose}>{t('关闭')}</Button>}
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openUpload}>
            {t('上传文件')}
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('文件只对当前环境生效；用例里用 upload 节点的 file 字段引用 key。')}
          </Typography.Text>
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => t('共 {n} 个文件', { n: total }),
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          columns={[
            {
              title: t('文件 key'),
              dataIndex: 'key',
              width: 160,
              render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
            },
            { title: t('文件名'), dataIndex: 'original_name' },
            {
              title: t('大小'),
              dataIndex: 'size',
              width: 100,
              render: (value: number) => formatBytes(value),
            },
            {
              title: t('描述'),
              dataIndex: 'description',
              render: (value: string | null) => value || '-',
            },
            {
              title: t('上传人'),
              dataIndex: 'created_by_name',
              width: 110,
              render: (value: string | null) => value || '-',
            },
            {
              title: t('上传时间'),
              dataIndex: 'created_at',
              width: 170,
              render: (value: string) => new Date(value).toLocaleString(),
            },
            {
              title: t('操作'),
              width: 150,
              render: (_value, row) => (
                <Space>
                  <Button
                    size="small"
                    loading={download.isPending}
                    onClick={() => download.mutate(row)}
                  >
                    {t('下载')}
                  </Button>
                  <Popconfirm
                    title={t('删除这个文件？')}
                    description={t('引用它的用例会执行失败，需要重新上传。')}
                    onConfirm={() => remove.mutate(row.id)}
                  >
                    <Button size="small" danger loading={remove.isPending}>
                      {t('删除')}
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={uploadOpen}
        title={t('上传测试文件')}
        onCancel={() => setUploadOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={upload.isPending}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(values) => upload.mutate(values)}>
          <Form.Item
            name="key"
            label={t('文件 key')}
            rules={[
              { required: true, message: t('必填') },
              { pattern: KEY_PATTERN, message: t('只能包含字母、数字、下划线，且不能以数字开头') },
            ]}
          >
            <Input placeholder="INVOICE_PDF" />
          </Form.Item>
          <Form.Item label={t('文件')} required>
            <Upload
              beforeUpload={() => false}
              maxCount={1}
              fileList={fileList}
              onChange={({ fileList: next }) => setFileList(next)}
            >
              <Button>{t('选择文件')}</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="description" label={t('描述')}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="replace" valuePropName="checked">
            <Checkbox>{t('覆盖已存在的同名 key')}</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}