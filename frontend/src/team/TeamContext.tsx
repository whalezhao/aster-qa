import { createContext, useContext, type ReactNode } from 'react';
import { getActiveTeamId } from '../storage';

/**
 * 当前团队的唯一来源。
 *
 * 之前旧布局顶栏有一份自己的 useState、各个页面又各自 useState 读 localStorage，
 * 两边互不同步 —— 表现就是「一个页面里出现两个团队选择器」，而且顶栏切了团队，
 * 页面数据不跟着变。这里收敛成一份，由 AppShell 提供，页面只读。
 */
export interface TeamContextValue {
  teamId: string | null;
  setTeamId: (id: string | null) => void;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function TeamProvider({
  value,
  children,
}: {
  value: TeamContextValue;
  children: ReactNode;
}) {
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useActiveTeam(): TeamContextValue {
  const ctx = useContext(TeamContext);
  if (ctx) return ctx;
  // 兜底：理论上不会发生（AppShell 一定包了 Provider）。
  // 返回只读版本而不是抛错，避免某个页面漏包时整个白屏。
  return { teamId: getActiveTeamId(), setTeamId: () => {} };
}
