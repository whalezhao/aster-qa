// 当前选中测试团队持久化到 localStorage。
export const TEAM_KEY = 'qa_team_id';

export function getActiveTeamId(): string | null {
  return localStorage.getItem(TEAM_KEY);
}

export function setActiveTeamId(id: string | null): void {
  if (id) localStorage.setItem(TEAM_KEY, id);
  else localStorage.removeItem(TEAM_KEY);
}

// 版本公告已读到的版本号；顶栏据此显示未读小圆点。
export const RELEASE_SEEN_KEY = 'qa_release_notes_seen';
export const RELEASE_SEEN_EVENT = 'qa-release-notes-seen';

export function getSeenReleaseVersion(): string | null {
  try {
    return localStorage.getItem(RELEASE_SEEN_KEY);
  } catch {
    return null;
  }
}

export function setSeenReleaseVersion(version: string | null): void {
  try {
    if (version) localStorage.setItem(RELEASE_SEEN_KEY, version);
    else localStorage.removeItem(RELEASE_SEEN_KEY);
  } catch {
    // 隐私模式下 localStorage 不可用，顶栏仍在本次会话内通过事件同步
  }
  // 同一标签页的 storage 事件不会触发，手动通知顶栏刷新徽标。
  // detail 带上版本号，隐私模式下写不进 localStorage 也能在本次会话内清掉红点。
  window.dispatchEvent(new CustomEvent(RELEASE_SEEN_EVENT, { detail: version }));
}
