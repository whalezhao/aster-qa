import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './auth/AuthContext';

// 页面按路由懒加载：之前所有页面 + 图表库都打进同一个 3.8MB 的包，首屏白等
const AppShell = lazy(() => import('./layout/AppShell'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Teams = lazy(() => import('./pages/Teams'));
const TeamDetail = lazy(() => import('./pages/TeamDetail'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Projects = lazy(() => import('./pages/Projects'));
const FeatureDetail = lazy(() => import('./pages/FeatureDetail'));
const CaseEditor = lazy(() => import('./pages/CaseEditor'));
const CaseDraft = lazy(() => import('./pages/CaseDraft'));
const Tasks = lazy(() => import('./pages/Tasks'));
const TaskDetail = lazy(() => import('./pages/TaskDetail'));
const Executions = lazy(() => import('./pages/Executions'));
const ExecutionDetail = lazy(() => import('./pages/ExecutionDetail'));
const BatchReport = lazy(() => import('./pages/BatchReport'));
const RunDetail = lazy(() => import('./pages/RunDetail'));
const Stats = lazy(() => import('./pages/Stats'));
const Users = lazy(() => import('./pages/Users'));

function PageLoading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
      <Spin size="large" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/teams/:tid" element={<TeamDetail />} />
        <Route path="/users" element={<Users />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:pid" element={<ProjectDetail />} />
        <Route path="/features/:fid" element={<FeatureDetail />} />
        {/* 新建用例走对话生成；/cases/:cid 仍然可以手动编辑 YAML */}
        <Route path="/cases/new/:fid" element={<CaseDraft />} />
        {/* 修改模式：载入已有用例，继续用对话迭代 */}
        <Route path="/cases/:cid/ai" element={<CaseDraft />} />
        <Route path="/cases/:cid" element={<CaseEditor />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:tid" element={<TaskDetail />} />
        {/* 「执行记录」是任务粒度的批次列表；/runs/:rid 保留给单次 midscene 运行的详情（报告在这一层） */}
        <Route path="/executions" element={<Executions />} />
        <Route path="/executions/:bid" element={<ExecutionDetail />} />
        {/* 合规留存用的正式报告：独立页面，打印样式，可电子签章 */}
        <Route path="/executions/:bid/report" element={<BatchReport />} />
        <Route path="/runs" element={<Navigate to="/executions" replace />} />
        <Route path="/runs/:rid" element={<RunDetail />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Routes>
    </Suspense>
  );
}
