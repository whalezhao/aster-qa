/**
 * 英文文案表。key 是中文原文，value 是英文译文。
 *
 * 用「中文原文即 key」而不是给每条文案起名字：改造时可以按文件增量包 t()，
 * 漏翻的条目会原样回退中文，不会白屏。占位符与中文原文一致，形如 {name}。
 */
export const common: Record<string, string> = {
  // ---- 骨架 / 通用 ----
  'Aster QA · AI 测试管理平台': 'Aster QA · AI Test Management Platform',
  工作台: 'Dashboard',
  系统: 'Systems',
  测试任务: 'Test tasks',
  执行记录: 'Executions',
  统计: 'Stats',
  测试团队: 'Test teams',
  人员: 'Users',
  执行器: 'Runners',
  选择测试团队: 'Select test team',
  切换主题: 'Toggle theme',
  切换语言: 'Switch language',
  修改密码: 'Change password',
  退出登录: 'Sign out',
  '密码修改成功，请重新登录': 'Password changed. Please sign in again.',
  当前密码: 'Current password',
  新密码: 'New password',
  '请输入当前密码': 'Enter your current password',
  '请输入新密码': 'Enter a new password',
  '共 {n} 条': 'Total {n} items',
  '；': '; ',

  // ---- 登录页 ----
  '让 AI 跑测试，': 'Let AI run the tests,',
  '人只需要看结论': 'people just read the conclusion',
  '用例由 AI 生成与维护，人只做审阅和签名':
    'Cases are written and maintained by AI; people only review and sign off',
  '一次执行穿透到每个功能、每条用例、每份报告':
    'One run traces down to every feature, every case and every report',
  '统计口径带 Wilson 下界，不被偶发失败带偏':
    'Stats use a Wilson lower bound so occasional failures do not skew the numbers',
  '测试团队、系统、功能、用例一条链管到底：AI 生成用例、执行产生报告、人工签名背书、webhook 把结果送回你的工单系统。':
    'Test teams, systems, features and cases in one chain: AI writes cases, runs produce reports, people sign off, and webhooks send results back to your issue tracker.',
  登录: 'Sign in',
  '账号由测试团队管理员在「人员」里维护，忘记密码也找管理员重置。':
    'Accounts are managed by your test team admin under Users; ask them to reset a forgotten password.',
  用户名: 'Username',
  '请输入用户名': 'Enter your username',
  密码: 'Password',
  '请输入密码': 'Enter your password',

  // ---- 状态 / 类型标签 ----
  排队中: 'Queued',
  准备中: 'Preparing',
  执行中: 'Running',
  解析中: 'Parsing',
  '模型额度用尽': 'Model quota exhausted',
  '模型配置有误': 'Model misconfigured',
  '模型服务错误': 'Model service error',
  网络不可达: 'Network unreachable',
  无执行: 'No runs',
  完成: 'Completed',
  '完成 · 含失败': 'Completed · with failures',
  部分完成: 'Partially completed',
  未计入统计: 'Excluded from stats',
  执行失败: 'Run failed',
  已取消: 'Cancelled',
  执行超时: 'Timed out',
  '未计入统计 · {kind}': 'Excluded · {kind}',
  '完成 · 含 {n} 失败': 'Completed · {n} failed',
  单用例: 'Single case',
  功能回归: 'Feature regression',
  迭代回归: 'Iteration regression',
  临时: 'Ad hoc',
  草稿: 'Draft',
  已完成: 'Completed',
  失败: 'Failed',
};