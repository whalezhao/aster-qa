import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Col, Form, Input, Row, Space, Tooltip, Typography, theme } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import { SaveOutlined } from '@ant-design/icons';
import { Bubble, Prompts, Sender } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import {
  createCase,
  draftCaseWithAiStream,
  getCase,
  updateCase,
  validateYaml,
  type CaseDraftResult,
  type ChatMessage,
} from '../api/cases';
import { getFeature } from '../api/features';
import { apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import ModelConfigNotice from '../components/ModelConfigNotice';
import EnvVariableHint from '../components/EnvVariableHint';
import AiMascot from '../components/AiMascot';
import UserAvatar from '../components/UserAvatar';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import { t } from '../i18n';

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
  const { user: me } = useAuth();
  // 对话区/气泡的颜色走主题 token，深色模式下才不会出现一块刺眼的白
  const { token } = theme.useToken();
  const [form] = Form.useForm<{ name: string }>();

  // 从本地草稿恢复 —— 跳走、刷新、热更新后聊过的内容不该丢
  const initial = useMemo(() => loadDraft(draftKey), [draftKey]);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [yaml, setYaml] = useState<string | null>(initial.yaml);
  const [input, setInput] = useState(initial.input);

  // 任何一处变化都落盘
  useEffect(() => {
    saveDraft(draftKey, { messages, yaml, input });
  }, [draftKey, messages, yaml, input]);

  const { data: feature } = useQuery({
    queryKey: ['feature', fid],
    queryFn: () => getFeature(fid),
    enabled: Boolean(fid),
  });

  // 右侧 YAML 的实时校验，和手动编辑页用的是同一个接口
  const { data: validation } = useQuery({
    queryKey: ['validate-draft', yaml],
    queryFn: () => validateYaml(yaml as string),
    enabled: Boolean(yaml),
  });

  useEffect(() => {
    if (yaml) form.setFieldsValue({ name: guessCaseName(yaml) });
  }, [yaml, form]);

  // 修改模式：首次拿到用例内容时预填 YAML 和名称，只在没有草稿时做
  useEffect(() => {
    if (!editing || !existing) return;
    if (yaml === null) setYaml(existing.yaml_content);
    form.setFieldsValue({ name: guessCaseName(existing.yaml_content) });
    // 只在用例首次到达时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, existing]);

  // 滚动交给 Bubble.List 的 autoScroll，不再自己算 scrollHeight

  // 正在等模型 / 正在流式输出
  const [busy, setBusy] = useState(false);

  function applyDraftYaml(res: CaseDraftResult) {
    // yaml 的三态：null=这轮没给 YAML，右侧别动；""=模型明确要清空；其他=替换
    if (res.yaml === '') {
      setYaml(null);
      message.info(t('已按模型的要求清空右侧 YAML'));
    } else if (res.yaml) {
      setYaml(res.yaml);
      if (!res.yaml_ok && res.yaml_errors.length) {
        message.warning(t('模型给的 YAML 没通过校验，请让它修正'));
      }
    }
  }

  const save = useMutation({
    mutationFn: (v: { name: string }) =>
      editing
        ? updateCase(cid as string, { name: v.name, yaml_content: yaml as string })
        : createCase(fid, { name: v.name, yaml_content: yaml as string }),
    onSuccess: (saved) => {
      // 草稿已经变成正式用例，留着反而下次进来会看到过期内容
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
      await draftCaseWithAiStream(fid, history, yaml, {
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
      });
    } catch (e) {
      replaceLast(`⚠️ ${apiError(e)}`);
    } finally {
      setBusy(false);
    }
  }
  const canSave = Boolean(yaml) && (validation?.ok ?? false) && !save.isPending;
  const ready = !editing || Boolean(existing);

  const yamlLines = useMemo(() => (yaml ?? '').split('\n'), [yaml]);

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
        <Row gutter={12}>
          {/* 左：对话 —— Ant Design X 的 Bubble / Prompts / Sender */}
          <Col xs={24} lg={13}>
            <div
              style={{
                height: 520,
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
                    disabled={busy || messages.length === 0}
                    onClick={() => setMessages([])}
                  >
                    {t('清空对话')}
                  </Button>
                </Tooltip>
              </div>
            </div>
          </Col>

          {/* 右：YAML —— 用主题色而不是写死的深色，浅色模式下不再是一块突兀的黑 */}
          <Col xs={24} lg={11}>
            <div
              style={{
                height: 520,
                display: 'flex',
                flexDirection: 'column',
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  fontSize: 12,
                  color: token.colorTextSecondary,
                }}
              >
                <span>{t('YAML 预览')}</span>
                <span>
                  {yaml ? t('{n} 行', { n: yamlLines.length }) : t('还没有内容')}
                  {validation?.ok ? t(' · 解析出 {n} 个用例', { n: validation.case_count }) : ''}
                </span>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
                {yaml ? (
                  <pre
                    style={{
                      margin: 0,
                      color: token.colorText,
                      fontSize: 13,
                      lineHeight: 1.7,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {yamlLines.map((line, i) => (
                      <div key={i}>
                        <span
                          style={{
                            color: token.colorTextQuaternary,
                            userSelect: 'none',
                            display: 'inline-block',
                            width: 30,
                            textAlign: 'right',
                            marginRight: 12,
                          }}
                        >
                          {i + 1}
                        </span>
                        {line}
                      </div>
                    ))}
                  </pre>
                ) : (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                    }}
                  >
                    <AiMascot size={48} state={busy ? 'thinking' : 'idle'} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('生成的 YAML 会出现在这里')}
                    </Typography.Text>
                  </div>
                )}
              </div>
            </div>

            <EnvVariableHint projectId={feature?.project_id} style={{ marginTop: 8 }} />

            {yaml && (
              <>
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <Tooltip title={t('只清空右侧 YAML，聊天记录保留')}>
                    <Button type="link" size="small" danger onClick={() => setYaml(null)}>
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
          </Col>
        </Row>
      </ProCard>
    </div>
  );
}

