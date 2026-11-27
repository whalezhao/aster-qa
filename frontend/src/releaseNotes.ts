/**
 * 版本公告随前端一起发版，没有后端和后台界面。
 * 规则见 CONTRIBUTING.md「版本公告」：
 * - 数组从新到旧，第一条是最新版本；
 * - 最新一条的 version 必须等于 frontend/package.json 的 version（vite.config.ts 会校验）。
 */

export type ReleaseCategory = 'feature' | 'improvement' | 'fix';

export interface ReleaseNoteItem {
  category: ReleaseCategory;
  title: string;
  description: string;
}

export interface ReleaseNote {
  /** 语义化版本，如 0.3.0 */
  version: string;
  /** YYYY-MM-DD */
  date: string;
  items: ReleaseNoteItem[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.5.3',
    date: '2026-11-27',
    items: [
      {
        category: 'feature',
        title: '环境支持浏览器代理',
        description:
          '每个测试环境可以单独配置浏览器出站代理，适合通过 aTrust 等 VPN 访问内网系统。代理只作用于浏览器，模型调用和数据库连接不受影响。',
      },
      {
        category: 'improvement',
        title: '功能列表支持按名称和创建人筛选',
        description:
          '项目详情里的功能列表可以按功能名称搜索，也可以按创建人筛选；子功能命中时会保留父级路径。',
      },
    ],
  },
  {
    version: '0.5.2',
    date: '2026-11-27',
    items: [
      {
        category: 'improvement',
        title: 'AI 生成用例支持 XPath 精准定位',
        description:
          '在对话里给出 XPath 时，AI 会把它写进单元素动作步骤的 options.xpath，适合元素难找、页面遮挡或要求稳定点击的场景。XPath 命中时优先使用，未命中仍会按描述自动定位。',
      },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-11-27',
    items: [
      {
        category: 'feature',
        title: '测试任务按创建人筛选',
        description:
          '测试任务列表新增「创建人」列，可以按创建人筛选，也可以一键只看自己的任务，找自己的任务不用再翻列表。',
      },
      {
        category: 'feature',
        title: '执行记录按执行人筛选',
        description:
          '执行记录新增「执行人」筛选和「我的执行」快捷入口，可以直接筛出自己触发或执行过的记录。',
      },
      {
        category: 'improvement',
        title: '创建人可以管理自己的任务',
        description:
          '编辑和删除测试任务不再只限管理员：任务创建人也可以编辑或删除自己创建的任务；团队 owner / admin 仍可管理全部任务。',
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-27',
    items: [
      {
        category: 'feature',
        title: '跨功能用例依赖编排',
        description:
          '把需要按顺序执行的用例编成一个可复用的编排：可以跨功能选用例、设置前置依赖，无依赖的分支并行执行；前置失败时后续用例标记为「被前置阻塞」并计入失败。未加入编排的用例仍按原有分片并发执行，任务可以直接套用编排，也可以只重跑失败/阻塞的子图。',
      },
      {
        category: 'feature',
        title: '编排图编辑器与版本历史',
        description:
          '编排编辑器支持图和表格两种视图；图里可以拖动节点、连线、自动布局。每次保存或回滚都会生成一个版本，可在「版本历史」里查看和回滚，已套用的任务不受后续修改影响。',
      },
      {
        category: 'feature',
        title: '节点间数据传递',
        description:
          '新增「记录变量」步骤，可以从页面或数据库读取一个值，依赖它的节点用 ${变量名} 直接引用。例如先取订单号，再用订单号查询数据库或定位页面元素。',
      },
      {
        category: 'feature',
        title: '条件分支与循环',
        description:
          '编排节点可以设置简单条件（等于、不等于、包含、大于、小于），条件不满足时跳过该节点及下游，不按失败统计；也可以设置固定重复次数，按顺序执行多轮，前一轮记录的值会传给下一轮。',
      },
      {
        category: 'feature',
        title: '按环境的测试文件库',
        description:
          '在环境里上传图片、PDF、Excel 等测试文件，用例用 upload 节点按 key 引用；同一个 key 在不同环境可以指向不同文件。download 节点可以等待下载、校验文件名和大小，下载产物会保留在执行记录里。',
      },
      {
        category: 'feature',
        title: '数据库比对',
        description:
          '按环境配置 MySQL、OceanBase（MySQL 模式）或 PostgreSQL 只读连接，用例用 dbAssert 节点把页面取值和数据库列值做精确或带容差的比较。密码加密存储，只注入执行进程。',
      },
      {
        category: 'feature',
        title: '环境登录会话复用',
        description:
          '在环境里指定登录用例和可选的检查用例，执行时复用该环境的浏览器登录状态；会话失效会自动重新登录，并可选择自动重试失败用例。',
      },
      {
        category: 'improvement',
        title: '执行记录绑定实际执行的用例版本',
        description:
          '每条执行结果都会记录本次真正执行的 YAML 版本，从执行记录打开的是那一版，不会跳到最新版本。',
      },
      {
        category: 'improvement',
        title: '用例编辑器更好用',
        description:
          '步骤和 YAML 逐行对照，可以拖动调整列宽、按目录定位、对单步试跑；上传、下载、数据库比对、记录变量等步骤都有对应的可视化字段。',
      },
      {
        category: 'fix',
        title: '登录会话检查更准确',
        description:
          '检查用例只验证到部分页面时，不再被误判为会话失效；会话错误提示也不会再把弹窗撑破。',
      },
      {
        category: 'fix',
        title: '编辑与上传界面修复',
        description:
          '记录变量步骤的参数行在窄栏下不再溢出；上传测试文件的弹窗现在会正确显示在文件列表之上。',
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-25',
    items: [
      {
        category: 'feature',
        title: '环境变量支持随机值',
        description:
          '环境变量现在可以选择固定值、随机字符串或随机数字，并设置 1–128 位长度；每次执行自动生成，适合手机号、验证码、编号等测试数据。',
      },
      {
        category: 'improvement',
        title: '执行记录显示执行人',
        description:
          '执行记录列表新增「执行人」列，可以直接看到这次执行由谁触发。',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-24',
    items: [
      {
        category: 'feature',
        title: '新建测试任务时可以精确选择功能或用例',
        description:
          '任务的功能选择器现在会展开到用例：勾选功能会包含其下所有启用用例，也可以只勾单条用例；每条用例旁会显示 P0–P3 优先级。',
      },
      {
        category: 'improvement',
        title: '选择系统后自动过滤功能树',
        description:
          '在新建任务里先选系统，功能树只显示该系统；如果先选了功能再切换系统，会提示并移除其它系统的选择，避免建出范围混乱的任务。',
      },
    ],
  },
];

export const LATEST_RELEASE_VERSION: string | null = RELEASE_NOTES[0]?.version ?? null;