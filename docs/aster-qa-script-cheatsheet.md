# Aster QA 用例脚本快捷指导书

> 适用：Aster QA 执行器当前版本。节点参数的完整清单以执行器版本的「节点说明」为准，本页是常用写法的速查。

## 1. 基本结构

平台里 **一个脚本文件 = 一条用例记录**，文件内可以写多个 `cases`：

```yaml
beforeEach:
  - gotoUrl: ${BASE_URL}

cases:
  - name: 登录后进入首页
    steps:
      - aiAct: 在账号输入框输入 ${ACCOUNT}，在密码输入框输入 ${{PASSWORD}}，点击登录
      - aiWaitFor: 出现组织机构选择界面
      - aiAssert: 页面右上角显示了当前登录用户
```

规则：

- `beforeEach` / `afterEach` / `beforeAll` 里写节点，写法与 `steps` 相同。
- **一个 step 只能有一个节点**。`cacheable` 这类参数必须写在节点的 `options` 里，不能和节点平级。
- 节点既可以写字符串简写，也可以写对象形式；需要参数时用对象形式。

## 2. 变量

| 写法 | 来源 | 说明 |
| --- | --- | --- |
| `${VAR}` | 项目「环境与变量」里的**普通变量** | 会被替换进脚本文本，写进执行目录的配置 |
| `${{SECRET}}` | 环境里的**密钥** | 只注入子进程环境变量，不落盘、不进报告 |
| `${BASE_URL}` | 所选环境的 `base_url`（为空时回落项目地址） | 平台自动注入，不要自己配同名变量 |

- 变量按**执行时选择的环境**注入；同一份脚本换环境就是另一套数据。
- 变量未定义会在**收集阶段**直接报错，整份脚本一条用例都不跑，例如：
  `Undefined project variable "BASE_URL"` / `Undefined environment variable "PASSWORD"`。
- 变量名只能字母、数字、下划线，不能以数字开头；`BASE_URL` 是保留名。

## 3. 常用节点速查

| 节点 | 简写示例 | 常用参数 |
| --- | --- | --- |
| `aiAct` | `aiAct: 点击登录按钮` | `options.cacheable`、`options.deepLocate`、`options.effort`、`options.context`、`options.fileChooserAccept` |
| `aiAssert` | `aiAssert: 页面显示“保存成功”` | `message`（**顶层字段**，失败时的说明）、`options.context` |
| `aiWaitFor` | `aiWaitFor: 出现保存成功提示` | `options.timeoutMs`（默认 15000）、`options.checkIntervalMs`（默认 3000）、`options.context` |
| `gotoUrl` | `gotoUrl: ${BASE_URL}` | `timeoutMs`（默认 60000）、`waitUntil`（`commit`/`domcontentloaded`/`load`/`networkidle`） |
| `aiTap` | `aiTap: 右下角的保存按钮` | `options.cacheable`、`options.deepLocate`、`options.xpath` |
| `aiInput` | 对象形式：`prompt` + `value` | `options.mode`、`options.keyboardTypeDelay`、`options.deepLocate`、`options.cacheable` |
| `aiKeyboardPress` | `aiKeyboardPress: Enter` | `prompt`（可选，指定目标元素） |
| `aiScroll` | `aiScroll: 向下滚动到列表底部` | `options.scrollType`、`options.direction`、`options.distance`、`options.cacheable` |
| `aiQuery` | `aiQuery: 提取商品列表 {name: string, price: number}[]` | `options.context`、`options.domIncluded`、`options.screenshotIncluded` |
| `aiString` / `aiNumber` / `aiBoolean` | `aiString: 读取订单号` | 同上 |
| `wait` | 对象形式：`duration: 2, unit: s` | `unit` 取 `ms` / `s` / `min` |
| `sleep` | 对象形式：`ms: 2000` | 固定等待，不轮询 |
| `javascript` | `javascript: document.title` | 在页面上下文求值一个**表达式**，返回值存下来；不要写 `return` |
| `recordToReport` | `recordToReport: 关键步骤截图` | `options.content`、`options.screenshots` |

其余节点（`aiLocate`、`aiHover`、`aiDoubleClick`、`aiRightClick`、`aiDragAndDrop`、`aiAsk`、`aiLongPress`、`aiPinch`、`aiClearInput`、`setViewportSize`、`setCookies`、`clearCookies`、`setAIContext`、`runGherkinScenario` 等）见执行器自带的节点说明。

### 字符串简写 vs 对象形式

```yaml
# 简写：等价于 { prompt: ... }
- aiAssert: 页面显示“保存成功”字样

# 对象：需要参数时
- aiAssert:
    prompt: 页面显示“保存成功”字样
    message: 保存后没有出现成功提示
```

`gotoUrl` / `aiKeyboardPress` / `javascript` 的简写分别映射到 `url` / `keyName` / `script`。

## 4. 等待慢操作（例如保存要 3 分钟）

`aiWaitFor` 默认只等 15 秒、每 3 秒查一次，慢操作必须显式放大：

```yaml
- aiAct:
    prompt: 点击屏幕右下方的“保存”按钮
    options:
      cacheable: false
- aiWaitFor:
    prompt: 页面出现保存成功的提示信息
    options:
      timeoutMs: 240000      # 4 分钟，给 3 分钟的操作留余量
      checkIntervalMs: 10000 # 每 10 秒查一次；每次检查都是一次模型调用
- aiAssert: 页面显示“保存成功”字样
```

- `checkIntervalMs` 不要用默认 3000：3 分钟会检查约 60 次，每次都烧 token。
- `wait` / `sleep` 是固定等待，不会判断结果，不能用它等“保存成功”。
- 平台侧的 `CASE_TIMEOUT_MS`（默认 600000，即 10 分钟）是**每个 step 的超时**。step 上不能单独写超时（一个 step 只能有一个节点），所以 `aiWaitFor.options.timeoutMs` 写得比它大也没用，会先被 step 超时打断 —— 要等更久只能让运维调大 `CASE_TIMEOUT_MS`。

## 5. 缓存（cacheable）

- `aiAct`、`aiTap` 等操作节点默认 `cacheable: true`；同一个 prompt 命中缓存时会跳过模型调用。
- 数据相关、每次结果不同的步骤要设 `cacheable: false`，例如新增记录、提交表单、输入变量值。
- 断言类（`aiAssert`、`aiWaitFor`）没有 `cacheable` 参数。

## 6. 常见报错

| 报错 | 原因 | 改法 |
| --- | --- | --- |
| `Node "aiWaitFor" input validation failed at "prompt": Invalid input` | 字段名写错（例如写了 `assertion`），或缺 `prompt` | 改成 `prompt:` |
| `Undefined project variable "BASE_URL"` | 环境与项目地址都为空，但脚本引用了 `${BASE_URL}` | 给环境或项目补 `base_url`；平台会在执行前直接拦截 |
| `Undefined environment variable "XXX"` | 引用了 `${{XXX}}`，但当前环境没配这个密钥 | 到对应环境补密钥 |
| `只能有一个节点` / `must contain exactly one node` | 一个 step 里写了多个字段 | 拆成多个 step |
| 脚本收集失败 | 结构或变量问题，整份文件不执行 | 看执行详情里的「执行报错」，会带具体文件和原因 |

## 7. 平台侧行为

- **环境**：执行时可选一个或多个环境；选多个则每个环境各生成一条执行记录，变量按各自环境注入。
- **重试**：任务上的「重试次数」对整条用例生效。
- **超时**：单用例超时由后端 `CASE_TIMEOUT_MS` 控制。
- **收集失败**：脚本解析不出来、变量未定义等，执行记录会记为失败并展示具体原因，不会再显示「完成 0/0」。
