// 当前选中团队持久化到 localStorage。
export const TEAM_KEY = 'qa_team_id';

export function getActiveTeamId(): string | null {
  return localStorage.getItem(TEAM_KEY);
}

export function setActiveTeamId(id: string | null): void {
  if (id) localStorage.setItem(TEAM_KEY, id);
  else localStorage.removeItem(TEAM_KEY);
}
