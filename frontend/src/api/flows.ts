import { http } from './client';
import type {
  CaseFlowDetail,
  CaseFlowInput,
  CaseFlowSummary,
  FlowRunResult,
  TaskDependency,
} from './types';

export async function listCaseFlows(projectId: string): Promise<CaseFlowSummary[]> {
  const { data } = await http.get<CaseFlowSummary[]>(
    `/api/projects/${projectId}/case-flows`,
  );
  return data;
}

export async function getCaseFlow(flowId: string): Promise<CaseFlowDetail> {
  const { data } = await http.get<CaseFlowDetail>(`/api/case-flows/${flowId}`);
  return data;
}

export async function createCaseFlow(
  projectId: string,
  input: CaseFlowInput,
): Promise<CaseFlowSummary> {
  const { data } = await http.post<CaseFlowSummary>(
    `/api/projects/${projectId}/case-flows`,
    input,
  );
  return data;
}

export async function updateCaseFlow(
  flowId: string,
  input: CaseFlowInput,
): Promise<CaseFlowSummary> {
  const { data } = await http.put<CaseFlowSummary>(
    `/api/case-flows/${flowId}`,
    input,
  );
  return data;
}

export async function deleteCaseFlow(flowId: string): Promise<void> {
  await http.delete(`/api/case-flows/${flowId}`);
}

export async function runCaseFlow(
  flowId: string,
  environmentNames: string[] = [],
): Promise<FlowRunResult> {
  const { data } = await http.post<FlowRunResult>(`/api/case-flows/${flowId}/run`, {
    environment_names: environmentNames,
  });
  return data;
}

export async function applyFlowToTask(
  taskId: string,
  flowId: string,
  replaceDependencies = false,
): Promise<{ added_cases: number; added_edges: number; dependency_count: number }> {
  const { data } = await http.post(`/api/tasks/${taskId}/apply-flow`, {
    flow_id: flowId,
    replace_dependencies: replaceDependencies,
  });
  return data;
}

export async function getTaskDependencies(
  taskId: string,
): Promise<TaskDependency[]> {
  const { data } = await http.get<{ dependencies: TaskDependency[] }>(
    `/api/tasks/${taskId}/case-dependencies`,
  );
  return data.dependencies;
}

export async function setTaskDependencies(
  taskId: string,
  dependencies: TaskDependency[],
): Promise<TaskDependency[]> {
  const { data } = await http.put<{ dependencies: TaskDependency[] }>(
    `/api/tasks/${taskId}/case-dependencies`,
    { dependencies },
  );
  return data.dependencies;
}