import type { ReactNode } from 'react';
import { ProTable, type ProColumns, type ProTableProps } from '@ant-design/pro-components';

/**
 * ProTable 的列适配层。
 *
 * 我们的列一直按 antd Table 的约定写：`render(value, record, index)`，第一个参数是**当前字段值**。
 * 而 ProTable 的 `render(dom, record, index, action)` 第一个参数是**已经渲染好的 DOM**，
 * 直接把同一份列定义交给它，`render(v) => v.name` 这类代码会拿到 ReactNode 而崩掉。
 *
 * 与其把几十个列逐个改写（还容易漏），不如在这一层按 antd 的语义把值补回去 ——
 * 列定义保持原样，行为也和以前完全一致。
 * 另外统一关掉 ProTable 的查询表单和工具栏：列表数据一直是我们自己管的（分页/排序/勾选）。
 */
/**
 * 列定义仍然是 antd 风格：`render(value, record, index)`，但 record 有类型，
 * 页面里写 `(_, r) => r.name` 依然能推导出 r 的类型。
 */
export type QaColumn<T> = Omit<ProColumns<T>, 'render'> & {
  render?: (value: any, record: T, index: number, action?: any) => ReactNode;
};

type QaTableProps<T> = Omit<ProTableProps<T, any>, 'columns'> & {
  columns?: QaColumn<T>[];
};

export default function QaTable<T extends Record<string, any>>(props: QaTableProps<T>) {
  const columns = (props.columns ?? []).map((column) => {
    const render = column.render;
    if (!render) return column;
    return {
      ...column,
      render: (_dom: any, record: T, index: number, action: any) =>
        // 没有 dataIndex 的列（操作列这类）第一个参数本来就是 record 无关的值，
        // 传 undefined 和 antd 的语义一致。
        render((record as any)?.[column.dataIndex as string], record, index, action),
    };
  });
  return <ProTable<T> search={false} options={false} {...props} columns={columns as any} />;
}
