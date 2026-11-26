import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Collapse,
  Form,
  Input,
  Segmented,
  Space,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { DownloadOutlined, SaveOutlined } from '@ant-design/icons';
import { Bubble, Prompts, Sender } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import {
  createCase,
  draftCaseWithAiStream,
  exportFeatureCases,
  getCase,
  getCaseAiDraft,
  getFeatureAiDraft,
  saveCaseAiDraft,
  saveFeatureAiDraft,
  trialRun,
  updateCase,
  validateYaml,
  type CaseAiDraft,
  type CaseDraftResult,
  type ChatMessage,
  type TrialStepOption,
} from '../api/cases';
import { getProjectDataSources } from '../api/datasources';
import { getFeature } from '../api/features';
import { getRun } from '../api/runs';
import { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import ModelConfigNotice from '../components/ModelConfigNotice';
import EnvVariableHint from '../components/EnvVariableHint';
import AiMascot from '../components/AiMascot';
import UserAvatar from '../components/UserAvatar';
import CaseOutline from '../components/CaseOutline';
import CaseTestTable from '../components/CaseTestTable';
import StepYamlPanel from '../components/StepYamlPanel';
import UnifiedDiff from '../components/UnifiedDiff';
import { previewStepOptions, type StepOption } from '../lib/caseYaml';
import { downloadBlob, testCaseFileName } from '../lib/download';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import { useResizablePercent } from '../lib/useResizablePercent';
import { t } from '../i18n';
import type { CaseStep, RunDetail, TestCaseDoc } from '../api/types';

/** 空状态给的起手示例 —— 比一个光标干等着好，顺便示范「把测试数据一起给它」。 */
const EXAMPLES = [
  '测试登录：用 qa@acme.test 和错误密码 hunter3 登录，应该看到错误提示并停留在登录页',
  '测试搜索：搜索关键词 zzz_not_exist，应该显示空结果提示',
  '测试新增：在表单里填名称「回归测试」，提交后列表里应该出现这条记录',
];

/** 从 YAML 里猜一个用例名（第一条 cases 的 name），用来预填保存表单。 */
function guessCaseName(yaml: string): string {
  const match = yaml.match(/^\s*-\s*name:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

/**
 * 两种模式共用一个页面：
 * - 新建 `/cases/new/:fid` —— 从零对话生成
 * - 修改 `/cases/:cid/ai` —— 载入已有用例的 YAML，继续对话迭代
 *
 * 草稿按「新建=功能 / 修改=用例」分开存，两边的对话不会互相覆盖。
 */
export default function CaseDraft() {
  const { fid: fidParam, cid } = useParams();
  const editing = Boolean(cid);
  const draftKey = cid ? `case_${cid}` : `feature_${fidParam}`;

  // 修改模式要先拿到用例，才知道它属于哪个功能、当前 YAML 是什么
  const { data: existing } = useQuery({
    queryKey: ['case', cid],
    queryFn: () => getCase(cid as string),
    enabled: editing,
  });
  const fid = cid ? (existing?.feature_id ?? '') : (fidParam ?? '');
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  // 对话区/气泡的颜色走主题 token，深色模式下才不会出现一块刺眼的白
  const { token } = theme.useToken();
  const [form] = Form.useForm<{ name: string; description?: string }>();

  // 从本地草稿恢复 —— 跳走、刷新、热更新后聊过的内容不该丢
  const initial = useMemo(() => loadDraft(draftKey), [draftKey]);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [yaml, setYaml] = useState<string | null>(initial.yaml);
  const [input, setInput] = useState(initial.input);
  const [modelSteps, setModelSteps] = useState<CaseStep[] | null>(null);
  const [modelTestCases, setModelTestCases] = useState<TestCaseDoc[] | null>(null);
  const [stepOpts, setStepOpts] = useState<Record<string, StepOption>>({});
  const chatSplit = useResizablePercent('qa-split-case-chat', 33, 22, 60);
  const outlineSplit = useResizablePercent('qa-split-case-outline', 33, 18, 50);
  const [appendMode, setAppendMode] = useState(false);
  const [viewMode, setViewMode] = useState<'yaml' | 'table'>('yaml');
  const [diff, setDiff] = useState<string | null>(null);
  const [trial, setTrial] = useState<RunDetail | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const trialTimer = useRef<number | null>(null);
  const draftSaveSeq = useRef(0);
  const draftCleared = useRef(false);
  useEffect(() => {
    draftCleared.current = false;
  }, [draftKey]);

  // 任何一处变化都先落本机，数据库请求失败时至少不丢
  useEffect(() => {
    saveDraft(draftKey, { messages, yaml, input });
  }, [draftKey, messages, yaml, input]);

  // 数据库里的对话草稿（按当前用户 + 用例/功能），换浏览器/清缓存也能续上
  const draftTarget = cid ? `case:${cid}` : fidParam ? `feature:${fidParam}` : '';
  const { data: serverDraft, isLoading: draftLoading } = useQuery({
    queryKey: ['ai-draft', draftTarget],
    queryFn: () => (cid ? getCaseAiDraft(cid) : getFeatureAiDraft(fidParam as string)),
    enabled: Boolean(draftTarget),
    retry: false,
  });
  const [draftHydrated, setDraftHydrated] = useState(false);

  useEffect(() => {
    if (draftHydrated || draftLoading || !draftTarget) return;
    if (draftCleared.current) {
      setDraftHydrated(true);
      return;
    }
    const local = loadDraft(draftKey);
    const serverHas =
      Boolean(serverDraft?.messages.length) ||
      Boolean(serverDraft?.yaml) ||
      Boolean(serverDraft?.input);
    if (serverDraft && serverHas) {
      setMessages(serverDraft.messages);
      setYaml(serverDraft.yaml);
      setInput(serverDraft.input);
    } else if (local.messages.length || local.yaml || local.input) {
      // 老用户浏览器里的草稿第一次打开时迁到数据库
      const state: CaseAiDraft = {
        messages: local.messages,
        yaml: local.yaml,
        input: local.input,
      };
      void (cid
        ? saveCaseAiDraft(cid, state)
        : saveFeatureAiDraft(fidParam as string, state)
      ).catch(() => {});
    }
    setDraftHydrated(true);
  }, [draftHydrated, draftLoading, draftTarget, serverDraft, draftKey, cid, fidParam]);

  const { data: feature } = useQuery({
    queryKey: ['feature', fid],
    queryFn: () => getFeature(fid),
    enabled: Boolean(fid),
  });
  const { data: datasources = [] } = useQuery({
    queryKey: ['project-datasources', feature?.project_id],
    queryFn: () => getProjectDataSources(feature!.project_id as string),
    enabled: Boolean(feature?.project_id),
  });

  // 右侧 YAML 的实时校验，和手动编辑页用的是同一个接口
  const { data: validation } = useQuery({
    queryKey: ['validate-draft', yaml],
    queryFn: () => validateYaml(yaml as string),
    enabled: Boolean(yaml),
  });
  const steps = modelSteps ?? validation?.steps ?? [];
  const testCases = modelTestCases ?? validation?.test_cases ?? [];
  const previewYaml = useMemo(
    () => (yaml ? previewStepOptions(yaml, steps, stepOpts) : ''),
    [yaml, steps, stepOpts],
  );

  useEffect(() => {
    if (yaml) form.setFieldsValue({ name: guessCaseName(yaml) });
  }, [yaml, form]);

  // 修改模式：首次拿到用例内容时预填 YAML 和名称，只在没有草稿时做
  useEffect(() => {
    if (!editing || !existing) return;
    if (yaml === null) setYaml(existing.yaml_content);
    form.setFieldsValue({
      name: guessCaseName(existing.yaml_content),
      description: existing.description ?? '',
    });
    // 只在用例首次到达时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, existing]);

  // 滚动交给 Bubble.List 的 autoScroll，不再自己算 scrollHeight

  // 正在等模型 / 正在流式输出
  const [busy, setBusy] = useState(false);

  // 对话/输入稳定 800ms 后写库；流式生成期间不写，避免把半截回复存进去
  useEffect(() => {
    if (!draftHydrated || busy) return;
    const seq = ++draftSaveSeq.current;
    const timer = window.setTimeout(() => {
      if (seq !== draftSaveSeq.current) return;
      const state: CaseAiDraft = { messages, yaml, input };
      void (cid
        ? saveCaseAiDraft(cid, state)
        : saveFeatureAiDraft(fidParam as string, state)
      ).catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, busy, cid, fidParam, messages, yaml, input]);

  function applyDraftYaml(res: CaseDraftResult) {
    if (res.lock_violated) {
      message.error(t('模型改动了已经验证过的步骤，本轮结果已丢弃，右侧保持原样'));
    }
    // yaml 的三态：null=这轮没给 YAML，右侧别动；""=模型明确要清空；其他=替换
    if (res.yaml === '') {
      setYaml(null);
      setModelSteps([]);
      setModelTestCases([]);
      setStepOpts({});
      setDiff(null);
      form.setFieldsValue({ description: '' });
      message.info(t('已按模型的要求清空右侧 YAML'));
    } else if (res.yaml) {
      setYaml(res.yaml);
      setModelSteps(res.steps ?? []);
      setModelTestCases(res.test_cases ?? []);
      setStepOpts({});
      setDiff(res.diff ?? null);
      form.setFieldsValue({ description: res.description ?? '' });
      if (!res.yaml_ok && res.yaml_errors.length) {
        message.warning(t('模型给的 YAML 没通过校验，请让它修正'));
      }
    }
  }

  const save = useMutation({
    mutationFn: async (v: { name: string; description?: string }) => {
      // 先把最新对话刷到数据库：新建时后端会把这份草稿挂到新用例上
      const state: CaseAiDraft = { messages, yaml, input };
      if (editing) await saveCaseAiDraft(cid as string, state);
      else await saveFeatureAiDraft(fid, state);
      const description = v.description?.trim() ?? '';
      return editing
        ? updateCase(cid as string, {
            name: v.name,
            description,
            yaml_content: previewYaml,
          })
        : createCase(fid, {
            name: v.name,
            description,
            yaml_content: previewYaml,
          });
    },
    onSuccess: (saved) => {
      // 本机缓存可以清；数据库里的对话保留，下次打开「AI 修改用例」还能看到
      clearDraft(draftKey);
      message.success(editing ? t('用例已更新') : t('用例已创建'));
      navigate(`/cases/${saved.id}`);
    },
    onError: (e) => message.error(apiError(e)),
  });

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy || !ready) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content }];
    // 先放一个空的 AI 气泡占位，流式增量直接往里追加
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);

    let streamed = '';
    const replaceLast = (value: string) =>
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', content: value };
        return copy;
      });

    try {
      const mode = appendMode ? 'append' : 'rewrite';
      if (mode === 'rewrite') {
        setTrial(null);
      }
      await draftCaseWithAiStream(
        fid,
        history,
        previewYaml || null,
        {
          onDelta: (chunk) => {
            streamed += chunk;
            replaceLast(streamed);
          },
          onDone: (res) => {
            replaceLast(res.reply);
            applyDraftYaml(res);
          },
          // 模型额度用尽、配置缺失这类错误要说清楚，混在气泡里比弹窗好找
          onError: (msg) => replaceLast(`⚠️ ${msg}`),
        },
        mode,
      );
    } catch (e) {
      replaceLast(`⚠️ ${apiError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function clearConversation() {
    // 只清对话，不丢右侧 YAML；同时把数据库草稿改成空对话，
    // 否则离开页面再回来会从服务端把旧历史重新灌回来。
    draftCleared.current = true;
    draftSaveSeq.current += 1;
    const state: CaseAiDraft = { messages: [], yaml, input: '' };
    setMessages([]);
    setInput('');
    saveDraft(draftKey, state);
    if (draftTarget) queryClient.setQueryData(['ai-draft', draftTarget], state);
    void (cid
      ? saveCaseAiDraft(cid, state)
      : saveFeatureAiDraft(fidParam as string, state)
    ).catch((error) => message.error(apiError(error)));
  }

  const stopTrial = () => {
    if (trialTimer.current) window.clearInterval(trialTimer.current);
    trialTimer.current = null;
    setTrialBusy(false);
  };
  useEffect(() => () => stopTrial(), []);

  /** 目录点击：滚动到对应 case / step，并短暂高亮。 */
  function jumpTo(key: string) {
    setHighlightKey(key);
    requestAnimationFrame(() => {
      document.getElementById(key)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  async function startTrial(caseIndex: number, stepLimit: number) {
    if (!previewYaml || trialBusy) return;
    const stepOptions: TrialStepOption[] = Object.entries(stepOpts).map(
      ([key, opt]) => {
        const [ci, si] = key.split(':').map(Number);
        const files = (opt.files ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        let params: (string | number | boolean | null)[] | undefined;
        if (opt.params !== undefined) {
          try {
            const parsed = JSON.parse(opt.params);
            if (Array.isArray(parsed)) params = parsed;
          } catch {
            // 非法 JSON 不覆盖原 YAML；后端校验会提示修正
          }
        }
        return {
          case_index: ci,
          step: si,
          cache: opt.cache,
          deep_locate: opt.deep,
          timeout_ms: opt.timeoutMs,
          effort: opt.effort,
          context: opt.context,
          message: opt.message,
          prompt: opt.prompt,
          trigger: opt.trigger,
          file: files.length === 1 ? files[0] : opt.file,
          files: files.length > 1 ? files : undefined,
          filename: opt.filename,
          min_bytes: opt.minBytes,
          save_as: opt.saveAs,
          datasource: opt.datasource,
          sql: opt.sql,
          params,
          column: opt.column,
          row: opt.row,
          as: opt.as,
          tolerance: opt.tolerance,
          selector: opt.selector,
          ignore_case: opt.ignoreCase,
        };
      },
    );
    setTrialBusy(true);
    setTrial(null);
    setTrialError(null);
    try {
      const result = await trialRun(
        fid,
        previewYaml,
        stepLimit,
        caseIndex,
        stepOptions,
      );
      const poll = async (): Promise<boolean> => {
        try {
          const run = await getRun(result.run_id);
          setTrial(run);
          if (
            ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(
              run.status,
            )
          ) {
            stopTrial();
            return true;
          }
          return false;
        } catch (e) {
          const msg = apiError(e);
          setTrialError(msg);
          message.error(msg);
          stopTrial();
          return true;
        }
      };
      if (!(await poll())) {
        trialTimer.current = window.setInterval(() => {
          void poll();
        }, 1500);
      }
    } catch (e) {
      const msg = apiError(e);
      setTrialError(msg);
      message.error(msg);
      setTrialBusy(false);
    }
  }

  async function exportTable() {
    if (!previewYaml || !fid || exporting) return;
    setExporting(true);
    try {
      const name = guessCaseName(previewYaml) || feature?.name || '测试用例';
      const blob = await exportFeatureCases(fid, previewYaml, name);
      downloadBlob(blob, testCaseFileName('测试用例', name));
      message.success(t('已导出'));
    } catch (e) {
      message.error(apiError(e));
    } finally {
      setExporting(false);
    }
  }

  const canSave = Boolean(previewYaml) && (validation?.ok ?? false) && !save.isPending;
  const ready = !editing || Boolean(existing);
  const yamlLineCount = previewYaml ? previewYaml.split('\n').length : 0;

  return (
    <div style={{ padding: 20 }}>
      <ModelConfigNotice projectId={feature?.project_id} action={t('用 AI 生成用例')} />

      <ProCard
        title={
          <Space>
            <span>{editing ? t('AI 修改用例') : t('新建用例')}</span>
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              {feature?.name ? t('功能：{name}', { name: feature.name }) : ''}
            </Typography.Text>
          </Space>
        }
        extra={
          editing ? (
            <Link to={`/cases/${cid}`}>{t('返回用例')}</Link>
          ) : (
            <Link to={`/features/${fid}`}>{t('返回功能')}</Link>
          )
        }
        bodyStyle={{ padding: 12 }}
      >
        <div ref={chatSplit.containerRef} className="qa-split-row">
          {/* 左：对话 —— Ant Design X 的 Bubble / Prompts / Sender */}
          <div
            className="qa-split-pane"
            style={{
              flex: `0 0 ${chatSplit.percent}%`,
              paddingRight: 6,
            }}
          >
            <div
              style={{
                height: 620,
                display: 'flex',
                flexDirection: 'column',
                background: token.colorFillQuaternary,
                borderRadius: 12,
                padding: 12,
              }}
            >
              {messages.length === 0 ? (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      padding: '12px 0 4px',
                    }}
                  >
                    <AiMascot size={72} state={busy ? 'thinking' : 'idle'} />
                    <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
                      {t('告诉我你想测什么')}
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('模型会把它写成可执行的用例，不需要懂 YAML，也不需要写选择器')}
                    </Typography.Text>
                  </div>
                  <Prompts
                    vertical
                    title={t('试试这些')}
                    style={{ marginTop: 16 }}
                    items={EXAMPLES.map((example, index) => ({
                      key: String(index),
                      label: t(example),
                    }))}
                    onItemClick={({ data }) => send(String(data.label ?? ''))}
                  />
                </div>
              ) : (
                <Bubble.List
                  style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
                  autoScroll
                  items={[
                    ...messages
                      // 流式开始前占位的空消息不渲染，先显示下面的「正在生成」
                      .filter((m, index) => !(busy && index === messages.length - 1 && !m.content))
                      .map((m, index) => ({
                        key: index,
                        role: m.role === 'user' ? 'user' : 'ai',
                        // AI 的回复是结构化 Markdown（用例名 / 覆盖流程 / 断言 / 数据），
                        // 按纯文本渲染会把 ** 和列表符号原样露出来
                        content:
                          m.role === 'user' ? (
                            m.content
                          ) : (
                            <div className="qa-chat-md">
                              <XMarkdown content={m.content} />
                            </div>
                          ),
                      })),
                    ...(busy && !messages[messages.length - 1]?.content
                      ? [{ key: 'typing', role: 'ai', content: t('正在生成…'), loading: true }]
                      : []),
                  ]}
                  roles={{
                    user: {
                      placement: 'end',
                      variant: 'filled',
                      avatar: (
                        <UserAvatar
                          avatar={me?.avatar}
                          name={me?.display_name || me?.username}
                          size={28}
                        />
                      ),
                    },
                    ai: {
                      placement: 'start',
                      variant: 'outlined',
                      avatar: <AiMascot size={24} state={busy ? 'thinking' : 'idle'} />,
                    },
                  }}
                />
              )}

              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('本轮模式')}
                </Typography.Text>
                <Segmented
                  size="small"
                  value={appendMode ? 'append' : 'rewrite'}
                  onChange={(value) => setAppendMode(value === 'append')}
                  disabled={!previewYaml || busy}
                  options={[
                    { label: t('改写'), value: 'rewrite' },
                    { label: t('续写（锁定前缀）'), value: 'append' },
                  ]}
                />
              </div>

              <Sender
                value={input}
                onChange={setInput}
                loading={busy}
                onSubmit={(text) => send(text)}
                placeholder={t('描述要测什么，或要求修改（Enter 发送，Shift+Enter 换行）')}
                style={{ marginTop: 12 }}
              />

              <div style={{ marginTop: 4, textAlign: 'right' }}>
                <Tooltip title={t('只清空聊天记录，右侧 YAML 保留')}>
                  <Button
                    type="link"
                    size="small"
                    disabled={busy}
                    onClick={clearConversation}
                  >
                    {t('清空对话')}
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>

          <div
            className="qa-split-handle"
            {...chatSplit.handleProps}
            style={{ color: token.colorTextTertiary }}
            aria-label={t('调整对话宽度')}
          />

          {/* 右：步骤 / YAML 对照 —— 用主题色而不是写死的深色 */}
          <div className="qa-split-pane" style={{ flex: '1 1 0', paddingLeft: 6 }}>
            <div
              style={{
                minHeight: 620,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '8px 12px',
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 10,
                  fontSize: 12,
                  color: token.colorTextSecondary,
                  background: token.colorFillQuaternary,
                }}
              >
                <Space size={8}>
                  <span>{t('步骤 / YAML 预览')}</span>
                  <Segmented
                    size="small"
                    value={viewMode}
                    onChange={(value) => setViewMode(value as 'yaml' | 'table')}
                    disabled={!previewYaml}
                    options={[
                      { label: t('步骤 / YAML'), value: 'yaml' },
                      { label: t('测试用例表'), value: 'table' },
                    ]}
                  />
                </Space>
                <Space size={8}>
                  <span>
                    {previewYaml ? t('{n} 行', { n: yamlLineCount }) : t('还没有内容')}
                    {validation?.ok
                      ? t(' · 解析出 {n} 个用例', { n: validation.case_count })
                      : ''}
                  </span>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={exporting}
                    disabled={!previewYaml || !fid || validation?.ok === false}
                    onClick={exportTable}
                  >
                    {t('导出 Excel')}
                  </Button>
                </Space>
              </div>

              {previewYaml ? (
                viewMode === 'table' ? (
                  <CaseTestTable cases={testCases} />
                ) : (
                <div ref={outlineSplit.containerRef} className="qa-split-row">
                  <div
                    className="qa-split-pane"
                    style={{ flex: `0 0 ${outlineSplit.percent}%`, paddingRight: 6 }}
                  >
                    <CaseOutline steps={steps} onJump={jumpTo} />
                  </div>
                  <div
                    className="qa-split-handle"
                    {...outlineSplit.handleProps}
                    style={{ color: token.colorTextTertiary }}
                    aria-label={t('调整目录宽度')}
                  />
                  <div className="qa-split-pane" style={{ flex: '1 1 0', paddingLeft: 6 }}>
                    <StepYamlPanel
                      yaml={previewYaml}
                      steps={steps}
                      options={stepOpts}
                      onOptionChange={(key, option) =>
                        setStepOpts((prev) => ({ ...prev, [key]: option }))
                      }
                      trial={trial}
                      trialBusy={trialBusy}
                      onTrial={(caseIndex, stepLimit) =>
                        startTrial(caseIndex, stepLimit)
                      }
                      highlightKey={highlightKey ?? undefined}
                      datasources={datasources}
                    />
                  </div>
                </div>
                )
              ) : (
                <div
                  style={{
                    minHeight: 460,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    border: `1px dashed ${token.colorBorderSecondary}`,
                    borderRadius: 10,
                  }}
                >
                  <AiMascot size={48} state={busy ? 'thinking' : 'idle'} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('生成的 YAML 会出现在这里')}
                  </Typography.Text>
                </div>
              )}
            </div>

            {trialBusy && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message={t('试跑执行中，请稍候…')}
              />
            )}
            {trialError && (
              <Alert
                type="error"
                showIcon
                closable
                style={{ marginTop: 8 }}
                message={t('试跑请求失败')}
                description={trialError}
                onClose={() => setTrialError(null)}
              />
            )}
            {!trialBusy && trial?.error_message && (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 8 }}
                message={t('试跑失败')}
                description={trial.error_message}
              />
            )}
            {!trialBusy && trial && !trial.error_message && (trial.failed ?? 0) > 0 && (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 8 }}
                message={t('试跑有失败步骤')}
                description={t('见下方步骤标记；也可以打开执行详情查看报告。')}
              />
            )}
            {!trialBusy &&
              trial &&
              !trial.error_message &&
              (trial.failed ?? 0) === 0 &&
              ['failed', 'timed_out', 'cancelled'].includes(trial.status) && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 8 }}
                  message={t('试跑未完成')}
                  description={t('执行没有正常结束，请打开执行详情查看原因。')}
                />
              )}

            {diff && (
              <Collapse
                size="small"
                style={{ marginTop: 8 }}
                items={[
                  {
                    key: 'diff',
                    label: t('本轮变更'),
                    children: <UnifiedDiff diff={diff} />,
                  },
                ]}
              />
            )}

            <EnvVariableHint projectId={feature?.project_id} style={{ marginTop: 8 }} />

            {previewYaml && (
              <>
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <Tooltip title={t('只清空右侧 YAML，聊天记录保留')}>
                    <Button
                      type="link"
                      size="small"
                      danger
                      onClick={() => {
                        setYaml(null);
                        setModelSteps([]);
                        setStepOpts({});
                        setDiff(null);
                        setTrial(null);
                      }}
                    >
                      {t('清空 YAML')}
                    </Button>
                  </Tooltip>
                </div>
                {validation?.ok ? (
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={t('YAML 校验通过，解析出 {n} 个用例', { n: validation.case_count })}
                  />
                ) : (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={t('YAML 校验不通过')}
                    description={
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {(validation?.errors ?? []).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    }
                  />
                )}

                <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
                  <Form.Item
                    name="name"
                    label={t('用例名称')}
                    style={{ marginTop: 12, marginBottom: 8 }}
                    rules={[{ required: true, message: t('请输入用例名称') }]}
                  >
                    <Input placeholder={t('用例名称')} />
                  </Form.Item>
                  <Form.Item
                    name="description"
                    label={t('描述')}
                    style={{ marginBottom: 8 }}
                  >
                    <Input.TextArea
                      autoSize={{ minRows: 3, maxRows: 8 }}
                      placeholder={t('可留空')}
                    />
                  </Form.Item>
                  <Tooltip title={canSave ? '' : t('需要 YAML 通过校验后才能保存')}>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      htmlType="submit"
                      loading={save.isPending}
                      disabled={!canSave}
                    >
                      {editing ? t('保存修改') : t('创建用例')}
                    </Button>
                  </Tooltip>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
                  >
                    {t('创建后可以真跑一遍验证效果。AI 靠视觉定位元素，描述越具体越稳 —— 写「页面中央蓝色的登录按钮」，别写「登录按钮」。')}
                  </Typography.Paragraph>
                </Form>
              </>
            )}
          </div>
        </div>
      </ProCard>
    </div>
  );
}

