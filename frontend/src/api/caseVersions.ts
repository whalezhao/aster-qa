import { http } from './client';
import type { CaseVersion } from './types';

export async function getCaseVersions(caseId: string): Promise<CaseVersion[]> {
  const { data } = await http.get<CaseVersion[]>(`/api/cases/${caseId}/versions`);
  return data;
}

export async function getCaseVersion(
  caseId: string,
  versionId: string,
): Promise<CaseVersion> {
  const { data } = await http.get<CaseVersion>(
    `/api/cases/${caseId}/versions/${versionId}`,
  );
  return data;
}

export async function getCaseVersionDiff(
  caseId: string,
  fromVersion: number,
  toVersion?: number,
): Promise<{ from_version: number; to_version: number; diff: string }> {
  const { data } = await http.get<{
    from_version: number;
    to_version: number;
    diff: string;
  }>(`/api/cases/${caseId}/versions/diff`, {
    params: { from_version: fromVersion, to_version: toVersion },
  });
  return data;
}

export async function rollbackCaseVersion(
  caseId: string,
  versionId: string,
): Promise<CaseVersion> {
  const { data } = await http.post<CaseVersion>(
    `/api/cases/${caseId}/versions/${versionId}/rollback`,
  );
  return data;
}
