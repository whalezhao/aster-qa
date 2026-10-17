import type { IterationStatus, Role } from '../../api/types';

export const roleOptions: { value: Role; label: string }[] = [
  { value: 'owner', label: '拥有者' },
  { value: 'admin', label: '管理员' },
  { value: 'member', label: '成员' },
];

export const statusColors: Record<IterationStatus, string> = {
  planned: 'default',
  active: 'processing',
  released: 'success',
  archived: 'warning',
};

export const statusLabels: Record<IterationStatus, string> = {
  planned: '计划中',
  active: '进行中',
  released: '已发布',
  archived: '已归档',
};

export const colorPresets = [
  '#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#8c8c8c',
];
