import type { Feature } from '../api/types';

/** TreeSelect 里用例节点的值前缀；功能仍是裸 id，提交时靠它拆开。 */
export const CASE_VALUE_PREFIX = 'case:';

export function splitSelection(ids: string[] = []): {
  feature_ids: string[];
  case_ids: string[];
} {
  const feature_ids: string[] = [];
  const case_ids: string[] = [];
  for (const id of ids) {
    if (id.startsWith(CASE_VALUE_PREFIX)) {
      case_ids.push(id.slice(CASE_VALUE_PREFIX.length));
    } else {
      feature_ids.push(id);
    }
  }
  return { feature_ids, case_ids };
}

export interface FeatureNode extends Feature {
  children?: FeatureNode[];
  /** 直属启用用例数 */
  ownCaseCount: number;
  /** 含后代合计 */
  caseCount: number;
}

/** 按 parent_id 建树；保持入参顺序（后端已按名称排序），叶子不写 children。 */
export function buildFeatureTree(
  features: Feature[],
  caseCounts: Record<string, number> = {},
): FeatureNode[] {
  const nodes = new Map<string, FeatureNode>();
  for (const feature of features) {
    const own = caseCounts[feature.id] ?? 0;
    nodes.set(feature.id, {
      ...feature,
      ownCaseCount: own,
      caseCount: own,
    });
  }

  const roots: FeatureNode[] = [];
  for (const feature of features) {
    const node = nodes.get(feature.id);
    if (!node) continue;
    const parent = feature.parent_id ? nodes.get(feature.parent_id) : undefined;
    if (parent) {
      (parent.children ??= []).push(node);
    } else {
      roots.push(node);
    }
  }

  const aggregate = (node: FeatureNode): number => {
    node.caseCount =
      node.ownCaseCount +
      (node.children ?? []).reduce((sum, child) => sum + aggregate(child), 0);
    return node.caseCount;
  };
  roots.forEach(aggregate);
  return roots;
}

/**
 * 分期/关键词筛选：节点自身命中或任一后代命中就保留（祖先作为路径上下文）。
 * 不命中的祖先 ownCaseCount 归零，避免筛选后父节点显示未筛选的用例数。
 */
export function filterFeatureTree(
  nodes: FeatureNode[],
  pred: (node: FeatureNode) => boolean,
): FeatureNode[] {
  const walk = (node: FeatureNode): FeatureNode | null => {
    const children = (node.children ?? [])
      .map(walk)
      .filter((child): child is FeatureNode => child !== null);
    if (!pred(node) && children.length === 0) return null;
    const ownCaseCount = pred(node) ? node.ownCaseCount : 0;
    return {
      ...node,
      children: children.length > 0 ? children : undefined,
      ownCaseCount,
      caseCount:
        ownCaseCount + children.reduce((sum, child) => sum + child.caseCount, 0),
    };
  };
  return nodes
    .map(walk)
    .filter((node): node is FeatureNode => node !== null);
}

/** 根 → 当前节点；数据有脏环时也不会死循环。 */
export function featurePath(features: Feature[], id: string): Feature[] {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const path: Feature[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path.reverse();
}

/** 不含自身，只返回整棵子树的 id。 */
export function descendantIds(nodes: FeatureNode[], id: string): string[] {
  const find = (list: FeatureNode[]): FeatureNode | undefined => {
    for (const node of list) {
      if (node.id === id) return node;
      const hit = node.children ? find(node.children) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  const target = find(nodes);
  if (!target) return [];

  const ids: string[] = [];
  const walk = (node: FeatureNode) => {
    for (const child of node.children ?? []) {
      ids.push(child.id);
      walk(child);
    }
  };
  walk(target);
  return ids;
}