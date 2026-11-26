export interface DagEdge {
  case_id: string;
  depends_on_case_id: string;
}

/**
 * 按最长路径分层；同一层没有依赖关系。返回 null 表示有环。
 */
export function dagLayers(nodes: string[], edges: DagEdge[]): string[][] | null {
  const nodeSet = new Set(nodes);
  const indegree = new Map<string, number>(nodes.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const child = edge.case_id;
    const parent = edge.depends_on_case_id;
    if (
      child === parent ||
      !nodeSet.has(child) ||
      !nodeSet.has(parent)
    ) {
      continue;
    }
    const children = adjacency.get(parent) ?? [];
    if (children.includes(child)) continue;
    children.push(child);
    adjacency.set(parent, children);
    indegree.set(child, (indegree.get(child) ?? 0) + 1);
  }

  let current = nodes.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const layers: string[][] = [];
  let visited = 0;
  while (current.length > 0) {
    layers.push(current);
    const next: string[] = [];
    for (const id of current) {
      visited += 1;
      for (const child of adjacency.get(id) ?? []) {
        const left = (indegree.get(child) ?? 1) - 1;
        indegree.set(child, left);
        if (left === 0) next.push(child);
      }
    }
    current = next.sort();
  }
  return visited === nodes.length ? layers : null;
}