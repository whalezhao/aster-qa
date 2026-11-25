import { http } from './client';
import type { ProjectFile, ProjectFilePage } from './types';

export async function getEnvironmentFiles(
  environmentId: string,
  params: { limit: number; offset: number },
): Promise<ProjectFilePage> {
  const { data } = await http.get<ProjectFilePage>(
    `/api/environments/${environmentId}/files`,
    { params },
  );
  return data;
}

export async function uploadEnvironmentFile(
  environmentId: string,
  input: {
    key: string;
    file: File;
    description?: string;
    replace?: boolean;
  },
): Promise<ProjectFile> {
  const body = new FormData();
  body.append('key', input.key);
  body.append('file', input.file);
  if (input.description) body.append('description', input.description);
  if (input.replace) body.append('replace', 'true');
  const { data } = await http.post<ProjectFile>(
    `/api/environments/${environmentId}/files`,
    body,
  );
  return data;
}

export async function deleteEnvironmentFile(
  environmentId: string,
  fileId: string,
): Promise<void> {
  await http.delete(`/api/environments/${environmentId}/files/${fileId}`);
}

/** 下载需要带 Authorization，不能用普通 <a href>。 */
export async function downloadEnvironmentFile(
  environmentId: string,
  file: ProjectFile,
): Promise<void> {
  const { data } = await http.get<Blob>(
    `/api/environments/${environmentId}/files/${file.id}`,
    { responseType: 'blob' },
  );
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.original_name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}