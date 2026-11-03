/**
 * 后端返回、前端原样展示的文案。
 *
 * key 是 Python 侧字符串字面量的原文（静态文案，不含插值）。
 * 带变量的消息在 `src/i18n/index.ts` 的 PATTERNS 里处理，不放这里。
 */
export const server: Record<string, string> = {
  // ---- app/api/ai.py ----
  '批次不存在': 'Batch not found',
  '任务不存在': 'Task not found',

  // ---- app/api/api_tokens.py ----
  'Token 不存在': 'Token not found',

  // ---- app/api/auth.py ----
  '尝试过于频繁，请 1 分钟后再试': 'Too many attempts. Try again in 1 minute',
  '用户名或密码错误': 'Incorrect username or password',
  '账号已停用': 'Account disabled',
  '原密码不正确': 'Current password is incorrect',

  // ---- app/api/batches.py ----
  '执行记录不存在': 'Execution not found',
  '没有可重跑的失败用例': 'No failed cases to rerun',
  '任务正在执行，请等当前批次结束再重跑':
    'The task is running. Wait for the current batch to finish before rerunning',
  '批次还没结束，不能重跑': 'The batch has not finished; cannot rerun',
  '源任务已删除，无法重跑': 'The source task was deleted; cannot rerun',
  '聚合报告不存在': 'Aggregated report not found',
  '非法路径': 'Invalid path',
  '文件不存在': 'File not found',
  '聚合报告尚未生成，暂时不能签章':
    'The aggregated report has not been generated yet; cannot sign',
  '聚合报告无法读取，暂时不能签章': 'The aggregated report cannot be read; cannot sign',
  '聚合报告版本不支持，暂时不能签章':
    'The aggregated report version is not supported; cannot sign',

  // ---- app/api/cases.py ----
  '模型调用额度已用尽（上游返回 429）。请更换模型或等额度恢复。':
    'Model quota exhausted (upstream returned 429). Switch models or wait for the quota to reset.',
  '模型拒绝了请求：API Key 无效或已过期。':
    'The model rejected the request: the API Key is invalid or expired.',
  '模型服务返回 404：模型名或接入地址可能不对。':
    'The model service returned 404: the model name or base URL may be incorrect.',
  '该功能下已有同名用例': 'A case with this name already exists in this feature',
  '非法分期': 'Invalid stage',
  '非法版本来源': 'Invalid version source',
  '起始版本不存在': 'Start version not found',
  '目标版本不存在': 'Target version not found',
  '版本不存在': 'Version not found',

  // ---- app/api/ci.py ----
  '任务正在执行，请稍后重试': 'The task is running. Try again later',
  '批次下没有执行记录': 'The batch has no executions',

  // ---- app/api/environments.py ----
  '环境不存在': 'Environment not found',
  '项目不存在': 'Project not found',
  '「默认」环境已存在': 'The "Default" environment already exists',
  '同名环境已存在': 'An environment with this name already exists',
  '默认环境不能改名': 'The default environment cannot be renamed',
  '仍有任务在使用这个环境名，不能改名':
    'Tasks still use this environment name; cannot rename',
  '默认环境的地址跟随项目 Base URL，请到项目设置修改':
    'The default environment URL follows the project Base URL. Change it in project settings',
  '默认环境不能删除': 'The default environment cannot be deleted',
  '仍有任务在使用这个环境，不能删除': 'Tasks still use this environment; cannot delete',

  // ---- app/api/features.py ----
  '该项目下已有同名功能': 'A feature with this name already exists in this project',
  '该功能已是正式功能': 'This feature is already a formal feature',
  '该功能已处于迭代中': 'This feature is already in an iteration',

  // ---- app/api/iterations.py ----
  '迭代不存在': 'Iteration not found',
  '该迭代名已存在': 'This iteration name already exists',

  // ---- app/api/projects.py ----
  '该项目名已存在': 'This project name already exists',
  '还没有填写模型接入地址': 'The model base URL is not filled in yet',
  '还没有填写模型名': 'The model name is not filled in yet',
  '模型健康检查未通过': 'Model health check failed',
  '连接成功，模型已正常响应': 'Connected. The model responded normally',

  // ---- app/api/runs.py ----
  '这次执行还没结束，不能重跑': 'This execution has not finished; cannot rerun',
  '该执行没有生成报告': 'This execution did not generate a report',
  '报告文件已被清理': 'The report file has been cleaned up',
  '报告不存在': 'Report not found',
  '该执行已经结束，无法取消': 'This execution has already ended; cannot cancel',
  '该执行没有可解析的产物目录':
    'This execution has no parseable artifact directory',

  // ---- app/api/stats.py ----
  '全部通过': 'All passed',
  '含失败': 'With failures',
  '执行失败': 'Execution failed',
  '非用例原因': 'Non-case cause',
  '取消/超时': 'Cancelled/timed out',
  '模型额度': 'Model quota',
  '模型服务': 'Model service',
  '网络': 'Network',
  '未知': 'Unknown',
  '请选择团队或项目': 'Select a team or project',
  '没有可访问的团队': 'No accessible teams',

  // ---- app/api/tags.py ----
  '标签不存在': 'Tag not found',
  '迭代不存在或不属于该团队': 'Iteration not found in this team',
  '该标签名已存在': 'This tag name already exists',

  // ---- app/api/task_common.py ----
  '任务下没有可执行的用例': 'The task has no runnable cases',

  // ---- app/api/task_runs.py ----
  '该任务已有执行在进行中': 'This task already has a run in progress',
  '所选功能必须都属于同一个团队':
    'Selected features must all belong to the same team',
  '所选功能下没有启用中的用例': 'Selected features have no enabled cases',
  '标签不存在或不属于该团队': 'Tag not found in this team',

  // ---- app/api/task_signoff.py ----
  '这个任务还没有用例，没什么可签的': 'This task has no cases; nothing to sign',
  '当前没有生效的签名': 'There is no active signature',

  // ---- app/api/tasks.py ----
  '非法任务类型': 'Invalid task type',
  '项目不存在或不属于该团队': 'Project not found in this team',
  '该任务有执行正在进行或排队中，请先取消再删除':
    'This task has a run in progress or queued. Cancel it before deleting',
  '有执行正在进行或排队中': 'A run is in progress or queued',

  // ---- app/api/teams.py ----
  '团队名已存在': 'Team name already exists',
  '团队不存在': 'Team not found',
  '非法角色': 'Invalid role',
  '用户不存在': 'User not found',
  '该用户已在团队中': 'This user is already in the team',
  '团队至少需要保留一名 owner': 'A team must keep at least one owner',

  // ---- app/api/users.py ----
  '用户名或邮箱已被占用': 'Username or email is already taken',
  '不能停用自己的账号': 'You cannot disable your own account',
  '不能删除自己': 'You cannot delete yourself',
  '该用户是某个团队唯一的 owner，停用后团队将无人可管理':
    'This user is the only owner of a team; disabling them would leave the team unmanaged',

  // ---- app/api/webhooks.py ----
  '未知通知渠道类型': 'Unknown notification channel type',
  '地址必须以 http:// 或 https:// 开头':
    'The URL must start with http:// or https://',
  '至少要订阅一个事件': 'Subscribe to at least one event',
  '通用 Webhook 必须设置签名密钥': 'A generic webhook must have a signing secret',
  'webhook 不存在': 'Webhook not found',
  '这个任务不属于该 webhook 的团队': 'This task does not belong to the webhook team',
  '投递记录不存在': 'Delivery record not found',

  // ---- app/deps.py ----
  '缺少凭证': 'Missing credentials',
  '凭证无效或已过期': 'Invalid or expired credentials',
  '凭证无效': 'Invalid credentials',
  '用户不存在或已停用': 'User not found or disabled',
  '需要团队管理员权限': 'Team administrator permission required',
  '功能不存在': 'Feature not found',
  '功能所属项目不存在': 'The project of this feature does not exist',
  '用例不存在': 'Test case not found',
  '用例所属功能不存在': 'The feature of this test case does not exist',
  '用例所属项目不存在': 'The project of this test case does not exist',

  // ---- app/preflight.py ----
  '没有配置被测地址': 'No target URL configured',
  '被测地址必须是 http/https URL': 'The target URL must be an http/https URL',
  '被测地址可访问': 'Target URL is reachable',
  '模型配置完整': 'Model configuration is complete',
  '还没有近期的模型连通性记录，可先点「测试连接」':
    'No recent model connectivity record. Try "Test connection" first',
  '模型连通正常': 'Model connectivity is normal',
  '执行器在线': 'Runner online',
  '没有在线的执行器，任务会一直排队': 'No runner is online; the task will stay queued',
  '默认': 'Default',

  // ---- app/modelconfig.py ----
  '模型名': 'Model name',
  '接入地址': 'Base URL',

  // ---- app/quality_gate.py ----
  '批次尚未结束': 'The batch has not finished',
  '没有有效执行（可能全部被模型/网络问题排除）':
    'No valid executions (all may have been excluded due to model or network issues)',
  '有效执行里没有用例结果': 'Valid executions contain no case results',

  // ---- app/environments.py ----
  '变量名只能包含字母、数字、下划线，且不能以数字开头':
    'Variable names may contain only letters, digits, and underscores, and cannot start with a digit',

  // ---- app/model_health.py ----
  'API Key 被拒绝': 'API Key rejected',
  'API Key 没有访问权限': 'API Key has no access permission',
  '接口路径不存在，确认地址是否以 /v1 结尾':
    'API path not found. Check whether the base URL ends with /v1',
  '模型服务返回错误': 'The model service returned an error',
  '对端在返回 HTTP 响应前断开连接，模型服务或网络不可达':
    'The peer disconnected before returning an HTTP response; the model service or network is unreachable',
  '模型配置不完整': 'Model configuration is incomplete',

  // ---- app/ci_tokens.py ----
  '无效的 API Token': 'Invalid API Token',
  'API Token 已失效': 'API Token has been revoked',
  'API Token 已过期': 'API Token has expired',

  // ---- app/scheduler.py ----
  'cron 需要 5 段：分 时 日 月 周': 'cron requires 5 fields: minute hour day month weekday',
  'cron 表达式不合法': 'Invalid cron expression',

  // ---- app/crypto.py ----
  '环境密钥无法解密：ENVIRONMENT_SECRET_KEY / SECRET_KEY 可能已更换':
    'The environment secret cannot be decrypted: ENVIRONMENT_SECRET_KEY / SECRET_KEY may have changed',

  // ---- app/case_versions.py ----
  '该功能下已有同名用例，无法回滚到这个版本':
    'A case with this name already exists in this feature; cannot roll back to this version',

  // ---- app/webhook.py（事件选择器的标签，非消息体）----
  '任务签名（人工审核通过）': 'Task signed (manually approved)',
  '一次执行完成': 'An execution completed',
  'AI 评估完成（给出结果结论与建议）':
    'AI assessment completed (with conclusions and suggestions)',
  '质量门禁未通过': 'Quality gate failed',
  '定时执行失败': 'Scheduled execution failed',
  '项目模型不可用': 'Project model unavailable',
  '测试投递（配好之后点一下看通不通）':
    'Test delivery (click to verify the connection)',
};