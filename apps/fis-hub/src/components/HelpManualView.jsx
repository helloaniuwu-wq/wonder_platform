import React, { useState } from 'react';
import { useLang } from '../i18n/langCore';
import {
  ChevronDown,
  ChevronRight,
  BookOpen,
  Monitor,
  BarChart3,
  Database,
  Compass,
  FlaskConical,
  Shield,
  Link2,
  FileText,
  Activity,
  Users,
  Search,
} from 'lucide-react';

/**
 * HelpManualView — 内嵌操作手册（v2.0），完整覆盖更新后的 FIS / PortfolioHub 全站功能与详细使用流程
 */

const chapters = [
  {
    id: 'ch0',
    icon: <Monitor size={16} />,
    titleZh: '第0章：认识系统与全新导航',
    titleEn: 'Ch.0: System Overview & Navigation',
    content: () => (
      <>
        <p>
          PortfolioHub（FIS 财富管理平台）是一套集<strong>实盘追踪、基金量化投研、AI 智能配置、蒙特卡洛退休仿真、保险/ILP 联动与持续监控</strong>于一体的全流程财富规划工作台。
        </p>
        <table className="hm-table">
          <thead>
            <tr>
              <th>主导航模块</th>
              <th>核心定位</th>
              <th>解决的核心问题</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>📊 组合 (Portfolios)</strong></td>
              <td>实盘组合管理与透视</td>
              <td>我的资产现在值多少？持仓是否漂移？行业/区域分布是否健康？</td>
            </tr>
            <tr>
              <td><strong>🗄️ 基金库 (Funds)</strong></td>
              <td>306+ 只基金量化体检库</td>
              <td>哪些 AIA 投连险基金或全球 ETF 表现最好？如何多基同框对比？</td>
            </tr>
            <tr>
              <td><strong>🧪 实验室 (Strategy Lab)</strong></td>
              <td>MPT 优化与蒙特卡洛仿真</td>
              <td>如何科学配比权重？未来两阶段退休提取成功率有多高？</td>
            </tr>
            <tr>
              <td><strong>🧭 智能配置 (Advisory)</strong></td>
              <td>双轨投顾与 AI 首席投顾</td>
              <td>根据客户画像，如何生成核心-卫星方案并由 AI 深度研判调仓？</td>
            </tr>
            <tr>
              <td><strong>🛡️ 組合監控 (Monitor)</strong></td>
              <td>跨组合持续追踪与宏观预警</td>
              <td>宏观环境变了没有？哪些客户组合触发了健康预警或需要再平衡？</td>
            </tr>
          </tbody>
        </table>

        <h4>角色权限一览</h4>
        <table className="hm-table">
          <thead>
            <tr>
              <th>角色</th>
              <th>标识颜色</th>
              <th>可用功能范围</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>admin</td>
              <td>🔴 红色</td>
              <td>全部业务功能 + 顾问客户管理 + 全平台用户权限管理</td>
            </tr>
            <tr>
              <td>advisor</td>
              <td>🔵 蓝色</td>
              <td>全部业务功能（含智能配置、策略实验室、监控大盘）+ 我的客户管理</td>
            </tr>
            <tr>
              <td>premium</td>
              <td>🟡 金色</td>
              <td>实盘组合、基金量化库、策略实验室、智能配置与组合监控</td>
            </tr>
            <tr>
              <td>free</td>
              <td>⚫ 灰色</td>
              <td>基础组合查看；策略实验室等高阶模块显示锁定提示，需联系管理员升级</td>
            </tr>
          </tbody>
        </table>

        <h4>界面布局与底部快捷入口</h4>
        <pre className="hm-code">{`┌──────────────────────────────────────────────────────────┐
│  顶部导航：当前用户与角色标签 · 语言切换 (中/EN) · 主题/登出 │
├──────────────┬───────────────────────────────────────────┤
│  左侧边栏     │               右侧主内容区                 │
│              │                                           │
│ 📊 组合      │  · 实盘仪表板 / X-Ray 透视 / 收入 / 追踪    │
│ 🗄️ 基金库    │  · 306+ 基金量化筛选、详情抽屉与 6 基对比   │
│ 🧪 实验室    │  · 经典组合库、MPT 优化、蒙特卡洛与保险联动 │
│ 🧭 智能配置  │  · 客户画像采集、核心-卫星方案、AI 首席投顾 │
│ 🛡️ 組合監控  │  · 每日宏观脉冲、跨组合健康评分与调仓草稿单 │
│              │                                           │
│ ──────────── │                                           │
│ 📖 操作手册  │  ← 随时点击查阅本完整手册                  │
│ 🔗 ILP 配置  │  ← 设置全局默认 ILP 投连险参数             │
└──────────────┴───────────────────────────────────────────┘`}</pre>
      </>
    ),
  },
  {
    id: 'ch1',
    icon: <BookOpen size={16} />,
    titleZh: '第1章：注册、登录与合规确认',
    titleEn: 'Ch.1: Registration, Login & Compliance',
    content: () => (
      <>
        <h4>Step 1.1 · 注册与激活账号</h4>
        <ol>
          <li>点击右上角「<strong>登录 / 注册</strong>」，切换到「<strong>注 册</strong>」标签页。</li>
          <li>填写您的姓名/显示名称、邮箱地址及密码（至少 6 位，建议包含大写字母与数字），勾选用户服务协议与隐私政策后提交。</li>
          <li>前往注册邮箱查收验证邮件，点击激活链接完成账号激活。</li>
        </ol>

        <h4>Step 1.2 · 登录与合规门禁</h4>
        <ol>
          <li>支持使用<strong>注册邮箱或用户名</strong> + 密码登录。</li>
          <li>首次进入平台会弹出<strong>《使用须知》合规声明弹窗</strong>，阅读后点击「我已阅读并了解，进入平台 →」即可进入主界面。</li>
          <li>右上角会显示您的名称与角色徽章；如需切换界面语言，可点击右上角「<strong>EN / 中</strong>」按钮。</li>
        </ol>
        <div className="hm-callout info">
          💡 合规声明为系统合规要求，清除浏览器缓存或更换设备后会再次弹出，属正常现象。
        </div>

        <h4>Step 1.3 · 找回密码</h4>
        <ol>
          <li>在登录弹窗点击「<strong>忘记密码？</strong>」，输入注册邮箱并发送重置链接。</li>
          <li>点击邮件中的重置链接，设置新密码后即可重新登录。</li>
        </ol>
      </>
    ),
  },
  {
    id: 'ch2',
    icon: <BarChart3 size={16} />,
    titleZh: '第2章：实盘组合建立、透视与日常管理',
    titleEn: 'Ch.2: Live Portfolio, X-Ray & Daily Management',
    content: () => (
      <>
        <div className="hm-dual">
          <span className="hm-tag advisor">🧑‍💼 顾问线</span>为客户建立存量资产组合并持续跟踪
          <span className="hm-tag personal">💡 个人线</span>录入个人真实持仓，实时核对收益与分红
        </div>

        <h4>Step 2.1 · 新建实盘组合</h4>
        <p>在左侧「<strong>组合</strong>」标签页点击底部「<strong>＋ 新建策略</strong>」，填写基础参数：</p>
        <table className="hm-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>说明</th>
              <th>填写建议</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>组合名称</td>
              <td>展示在左侧列表的名称</td>
              <td>如「张先生核心稳健组合」或「我的美股高息组合」</td>
            </tr>
            <tr>
              <td>计价货币</td>
              <td>组合核算基准货币</td>
              <td>支持 HKD / USD 等主流货币</td>
            </tr>
            <tr>
              <td>初始资金</td>
              <td>建仓总投入本金</td>
              <td>填客户实际投入或当前持仓总成本</td>
            </tr>
            <tr>
              <td>分红策略</td>
              <td>CASH（现金分红）或 DRIP（股息再投）</td>
              <td>退休取现选 CASH，长期复利滚雪球选 DRIP</td>
            </tr>
            <tr>
              <td>建仓日期</td>
              <td>历史表现曲线的起始锚点</td>
              <td>系统将从建仓日起构建本地化月末净值序列</td>
            </tr>
          </tbody>
        </table>

        <h4>Step 2.2 · 录入持仓与资产代码格式</h4>
        <p>在「初始配置」中添加资产代码与目标权重（合计须 = <strong>100%</strong>），也支持直接从基金库挑选代码：</p>
        <table className="hm-table">
          <thead>
            <tr>
              <th>市场 / 类型</th>
              <th>代码格式</th>
              <th>示例</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>美股 / 国际 ETF</td>
              <td>直接输入 Ticker</td>
              <td>VOO, QQQ, SCHD, AGG, GLD</td>
            </tr>
            <tr>
              <td>港股 / 港股 ETF</td>
              <td>数字代码.HK</td>
              <td>0005.HK, 0700.HK, 2800.HK</td>
            </tr>
            <tr>
              <td>A 股 / A 股 ETF</td>
              <td>代码.SS（沪）或 .SZ（深）</td>
              <td>600519.SS, 159915.SZ</td>
            </tr>
            <tr>
              <td>离岸 / 投连险基金</td>
              <td>ISIN 编码</td>
              <td>LU1041599405</td>
            </tr>
          </tbody>
        </table>
        <div className="hm-callout info">
          💡 左侧组合列表支持<strong>鼠标拖拽排序</strong>，松手后自动保存排列顺序。
        </div>

        <h4>Step 2.3 · 三大子标签页详解</h4>
        <ul>
          <li>
            <strong>1. 持仓与表现（Holdings &amp; Performance）</strong>：
            <ul>
              <li><strong>历史表现曲线</strong>：展示自建仓起的总净值走势；右上角可一键切换「<strong>应用 ILP</strong>」，同框对比原始市值与扣除投连险费用后的净值曲线，并可点击编辑本组合专属的 ILP 参数。</li>
              <li><strong>目标权重 vs 实际持仓漂移监控</strong>：当持仓因涨跌偏离目标权重时自动高亮提醒，支持一键发起再平衡。</li>
              <li><strong>Morningstar 组合透视（X-Ray）</strong>：穿透底层持仓，展示资产大类分布、行业板块暴露（Sector Exposure）及 Top 10 重仓占比。</li>
              <li><strong>核心指标卡与持仓表</strong>：查看资产市值、累计收益率（ROI）、累计分红、年化回报（CAGR）及各标的股数、均价、现价与盈亏。</li>
            </ul>
          </li>
          <li>
            <strong>2. 收入与预测（Income &amp; Projections）</strong>：
            <ul>
              <li>切换<strong>预扣税率</strong>（港股选 Gross 0%，美股选 US 30%）与 <strong>DRIP 模拟开关</strong>。</li>
              <li>查看组合 YOC（成本收益率）、当前股息率、未来 12 个月预期现金流柱状图及除息倒计时。</li>
              <li>对于无自动分红数据源的基金（如 LU-ISIN 基金），可点击顶部「<strong>录入分红</strong>」手动补录，系统将自动推算未来派息。</li>
            </ul>
          </li>
          <li>
            <strong>3. 持續追蹤與再評估（Monitor）</strong>：
            <ul>
              <li>查看单组合健康评分、TWR 时间加权回报与最大回撤。</li>
              <li>配置再平衡触发模式（阈值漂移 / 定期检视），支持手动点击「立即体检」、核对持仓对账单，以及一键生成<strong>再平衡草稿执行单</strong>并确认记账。</li>
            </ul>
          </li>
        </ul>

        <h4>Step 2.4 · 顶部常用操作栏</h4>
        <p>
          支持<strong>交易管理</strong>（增删改买卖记录）、<strong>再平衡</strong>（输入目标权重 → 计算预览买卖清单 → 执行）、<strong>撤销</strong>（回退最近一批交易）以及右上角 <strong>··· 菜单</strong>导出持仓快照 CSV 与分红历史 CSV。
        </p>
      </>
    ),
  },
  {
    id: 'ch3',
    icon: <Database size={16} />,
    titleZh: '第3章：基金量化库（306+ 基金投研与对比）',
    titleEn: 'Ch.3: Fund Quant Library & Comparison',
    content: () => (
      <>
        <p>
          点击左侧「<strong>基金库</strong>」，即可检索全库 <strong>306+ 只可追踪基金</strong>，涵盖 <strong>AIA 卓达智悦 2（TMP2）投连险基金池</strong> 与 <strong>全球 / 美 / 日 / 中港通 ETF 及债券基金</strong>，并与策略实验室无缝打通。
        </p>

        <h4>Step 3.1 · 多维度筛选与搜索</h4>
        <ol>
          <li><strong>选择平台分组</strong>：顶部切换「全部 / AIA 卓达智悦2 / 美·日·国际 ETF / A·港股通 ETF / 债券基金」。</li>
          <li><strong>关键词检索</strong>：在搜索框输入基金代码、ISIN、基金名称或管理人快速定位。</li>
          <li><strong>精细过滤条件</strong>：按资产大类（股票 / 固定收益等）、数据层级（Tier A / B）、量化评级、最低星级筛选，也可勾选「排除不推荐」或「仅看派息基金」。</li>
          <li><strong>字段排序</strong>：点击表格表头（如量化评分、年化收益、夏普比率、最大回撤、派息率等）进行升/降序排列。</li>
        </ol>

        <h4>Step 3.2 · 深度体检抽屉（Detail Drawer）</h4>
        <p>
          点击任意基金右侧的「<strong>👁️ 详情</strong>」按钮，滑出详情抽屉，查看完整历史净值走势、风险收益特征、费率与分红属性；抽屉右上角支持<strong>上一只 / 下一只</strong>连续浏览。
        </p>

        <h4>Step 3.3 · 多基对比篮与一键送入实验室</h4>
        <ol>
          <li>点击基金右侧「<strong>⇄ 对比</strong>」按钮，将其加入页面底部的<strong>对比篮（最多支持 6 只）</strong>。</li>
          <li>点击「<strong>开始对比</strong>」，弹出同框对比弹窗，横向比较各基金的收益、波动、回撤、夏普比率与费率。</li>
          <li>筛选满意后，可点击单只基金的「<strong>＋</strong>」或对比篮的「<strong>⚡ 整篮送入实验室</strong>」，系统自动携带所选标的跳转至「策略实验室」进行权重优化与回测。</li>
        </ol>
      </>
    ),
  },
  {
    id: 'ch4',
    icon: <Compass size={16} />,
    titleZh: '第4章：智能配置与 AI 首席投顾（核心-卫星）',
    titleEn: 'Ch.4: Smart Advisory & AI Chief Strategist',
    content: () => (
      <>
        <p>
          「<strong>智能配置</strong>」模块专为顾问面客与个人智能建仓打造，采用<strong>核心-卫星（Core-Satellite）架构</strong>与<strong>同质基金优胜劣汰</strong>算法，并接入流式 AI 首席投顾进行深度宏观研判与白名单调仓。
        </p>
        <div className="hm-callout warn">
          ⚠️ <strong>严格隔离原则</strong>：平台严格执行「纯投连险（ILAS）」与「纯非投连险（Off-Platform ETF）」隔离机制，两者绝不会在同一个推荐组合中混配。
        </div>

        <h4>Step 4.1 · 第一步：客户画像与需求采集（Step 1）</h4>
        <ol>
          <li>填写客户基础画像：风险承受能力、过往投资经验、核心投资期限、现金流/派息诉求与目标币种。</li>
          <li>选择<strong>产品池范围</strong>：
            <ul>
              <li>非投连险全市场基金 / ETF（纯平台外）</li>
              <li>非投连险 · 全球 / 美日低费 ETF</li>
              <li>非投连险 · 中港通红利与 A 股 ETF</li>
              <li>开启「<strong>纯投连险保单架构 (ILP)</strong>」开关 → 自动锁定 AIA 卓达智悦 2 投连险池</li>
            </ul>
          </li>
          <li>点击「<strong>生成量化推荐方案</strong>」进入第二步。</li>
        </ol>

        <h4>Step 4.2 · 第二步：审阅双轨方案与核心-卫星结构（Step 2）</h4>
        <p>系统基于 306 只基金量化库自动过滤合规标的，生成多套备选方案卡片：</p>
        <ul>
          <li>每张方案卡片清晰标注「<strong>纯投连险 · AIA</strong>」或「<strong>纯非投连险</strong>」徽章，以及「<strong>核心 XX% / 卫星 XX%</strong>」权重分布。</li>
          <li>顶部 KPI 条展示：<strong>参考 3Y 年化、组合波动率、Sharpe、参考派息、加权费率</strong>。</li>
          <li>持仓明细表标注每只标的在组合中的角色（核心 Core / 卫星 Sat）及量化入选理由。</li>
          <li>点击方案卡片的「<strong>套用到策略实验室</strong>」即可进入蒙特卡洛仿真；或保存本次配置记录以便日后回溯。</li>
        </ul>

        <h4>Step 4.3 · AI 首席投顾深度研判与白名单调仓</h4>
        <ol>
          <li>选中目标方案卡片后，在下方「<strong>AI 首席投顾深度研判</strong>」面板选择推理模型（默认首选 <strong>DeepSeek V4 Pro 极速版 ~30s</strong>，亦可选 DeepSeek V4 Pro 思考链 CoT 或 OpenRouter 模型如 Gemini 3.8 Flash）。</li>
          <li>点击生成后，系统通过 SSE 实时流式输出：宏观环境匹配度、核心-卫星结构归因、风险提示及同质基金优化建议。</li>
          <li>若 AI 建议微调仓位，仅允许从系统预设的<strong>AI 候补白名单</strong>中挑选合规标的，您可预览调仓前后的权重变化并一键点击「<strong>采纳 AI 调仓</strong>」（卡片将标记为 ⚡ AI 已调仓）。</li>
        </ol>
      </>
    ),
  },
  {
    id: 'ch5',
    icon: <FlaskConical size={16} />,
    titleZh: '第5章：策略实验室与蒙特卡洛退休仿真 ★',
    titleEn: 'Ch.5: Strategy Lab & Monte Carlo ★',
    content: () => (
      <>
        <div className="hm-callout warn">
          ⚠️ 本模块需要 <strong>premium</strong> 或以上权限；free 用户将看到功能锁定提示。
        </div>

        <h4>Step 5.1 · 资产沙盒配置：两种权重模式 + 经典组合库</h4>
        <ul>
          <li>
            <strong>权重模式切换</strong>：
            <ul>
              <li><strong>自定义权重</strong>：在每张资产卡片下方手动填写权重（%），合计须等于 100%。</li>
              <li><strong>自动优化</strong>：由 MPT 优化器自动求解最大夏普比率权重；可设置「<strong>单一资产上限</strong>」（如 30% / 40% / 不限）以防止过度集中。</li>
            </ul>
          </li>
          <li>
            <strong>经典组合库（Classic Portfolios）</strong>：点击「<strong>经典组合</strong>」按钮或「更多经典组合…」，可一键套用业界经典配置（如全天候 All-Weather、60/40 股债、黄金蝴蝶等），并支持切换美股 ETF 或 UCITS 标的版本。
          </li>
          <li>
            <strong>回测周期与收益校准模型（CMA）</strong>：建议优先选择数据最完整的 <strong>5 年</strong>回测周期；收益校准模型推荐「<strong>宏观利率与估值时钟前瞻</strong>」，也可按需切换大类资产中枢收缩、保守 LTCMA 或纯历史样本。
          </li>
        </ul>

        <h4>Step 5.2 · 运行优化与历史回测</h4>
        <p>点击「<strong>⚡ 运行优化</strong>」，约 3–5 秒完成计算，可在两个标签页查看结果：</p>
        <table className="hm-table">
          <thead>
            <tr>
              <th>指标 / 图表</th>
              <th>含义</th>
              <th>判读参考</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>组合对比表</td>
              <td>横向对比自定义 / 最大夏普 / 最小波动 / 风险平价</td>
              <td>可点击「部署」直接应用优化权重</td>
            </tr>
            <tr>
              <td>夏普比率 (Sharpe)</td>
              <td>每承担 1 单位风险获得的超额回报</td>
              <td>&gt; 1.0 良好，&gt; 2.0 优秀</td>
            </tr>
            <tr>
              <td>相关性矩阵</td>
              <td>资产两两之间的涨跌联动系数（-1 到 +1）</td>
              <td>相关性越低，分散风险效果越好</td>
            </tr>
            <tr>
              <td>历史回测曲线</td>
              <td>$10,000 买入并持有（不再平衡）增长曲线</td>
              <td>直观检验极端行情下的最大回撤</td>
            </tr>
          </tbody>
        </table>

        <h4>Step 5.3 · 蒙特卡洛退休规划仿真（10,000 条路径）★★</h4>
        <div className="hm-highlight">
          核心问题：「按这套配置 + 投入/提取计划，未来能否安稳退休、资金会否耗尽？」
        </div>
        <p>在「<strong>1. 波动投资组合配置</strong>」面板设置现金流参数（支持<strong>两阶段提款计划</strong>）：</p>
        <table className="hm-table">
          <thead>
            <tr>
              <th>参数</th>
              <th>填写说明</th>
              <th>典型示例</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>初始资本 ($)</td>
              <td>当前一次性可投入本金</td>
              <td>500,000</td>
            </tr>
            <tr>
              <td>年度追加 ($) | 起-止年</td>
              <td>积累期每年定投金额及起止年份</td>
              <td>100,000（第 1–10 年）</td>
            </tr>
            <tr>
              <td>年度提款 Stage 1 | 起-止年</td>
              <td>第一阶段退休/目标提取金额与年份</td>
              <td>200,000（第 11–25 年）</td>
            </tr>
            <tr>
              <td>年度提款 Stage 2 | 起-止年</td>
              <td>第二阶段提取（如子女教育结束或高龄看护）</td>
              <td>120,000（第 26–30 年）</td>
            </tr>
            <tr>
              <td>随通胀调整 &amp; 年数</td>
              <td>勾选后提取额按通胀率逐年递增；设置模拟总年数</td>
              <td>勾选通胀，模拟 30 年</td>
            </tr>
          </tbody>
        </table>
        <p>点击「<strong>⚡ 执行综合测试 / Run Monte Carlo</strong>」，查看结果：</p>
        <ul>
          <li><strong>三条情景线</strong>：🟢 乐观 P90（前 10% 好运）、🟣 中性 P50（中位数预期，核心参考）、🔴 悲观 P10（最差 10% 压力测试）。</li>
          <li><strong>退休成功率</strong>：模拟结束时资产未被提空的路径比例（&gt;80% 绿 · 50–80% 黄 · &lt;50% 红）。</li>
          <li><strong>内生分红与复投追踪（Block 4）</strong>：查看期末成本收益率（YOC）、分红复合增长率（DGR）、目标支出覆盖率（&gt;100% 即纯靠分红生活）与零成本拐点（Breakeven）。</li>
          <li><strong>保存历史方案</strong>：点击「<strong>保存此方案</strong>」命名存档，随时从左侧「💾 历史方案」重新加载或重命名。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'ch6',
    icon: <Shield size={16} />,
    titleZh: '第6章：稳健保险底座与 ILP 投连险分析',
    titleEn: 'Ch.6: Insurance Base & ILP Analysis',
    content: () => (
      <>
        <h4>6.1 稳健保险底座集成（Strategy Lab Block 2）</h4>
        <p>将储蓄型保险保单叠加进蒙特卡洛模型，量化评估“保底资产基石 + 波动投资组合”对退休成功率与最大回撤的缓冲效果：</p>
        <ol>
          <li>在蒙特卡洛区域展开「<strong>02 / 稳健保险产品配置 (Insurance Plan Integration)</strong>」并开启开关。</li>
          <li>上传标准格式的保单利益演示 Excel 文件（需包含以下列名）：
            <table className="hm-table">
              <thead>
                <tr>
                  <th>列名</th>
                  <th>含义</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code>year</code></td><td>保单年度（1, 2, 3...）</td></tr>
                <tr><td><code>premium</code></td><td>当年应缴保费</td></tr>
                <tr><td><code>guaranteed_value</code></td><td>保证现金价值</td></tr>
                <tr><td><code>total_value</code></td><td>总现金价值（含非保证红利）</td></tr>
                <tr><td><code>withdrawal</code></td><td>计划保单提取金额</td></tr>
              </tbody>
            </table>
          </li>
          <li>调节 <strong>Alpha Low</strong>（默认 0.80 悲观分红实现率）与 <strong>Alpha High</strong>（默认 1.20 乐观分红实现率），重新运行综合测试，即可在「综合现金流预览」与堆积柱状图中对比加保前后的成功率提升与回撤缓冲。</li>
        </ol>

        <h4>6.2 ILP 投连险费率与奖赏精确模拟（全局 + 单组合独立配置）</h4>
        <div className="hm-callout info">
          💡 平台支持<strong>两级 ILP 配置</strong>：左侧边栏底部「<strong>🔗 ILP 投连险配置</strong>」用于设置全局默认参数；每个实盘组合还可点击「<strong>应用 ILP / 编辑配置</strong>」保存独立的年龄、性别、吸烟状况与整付保费，后台将精确匹配对应 <strong>COI 保险成本表</strong>。
        </div>
        <ol>
          <li>在策略实验室 Block 1 底部开启「<strong>通过投连险（ILP）实现本组合</strong>」：系统自动将 Initial Capital 设为整付保费，并将 Annual Add 锁定为 0。</li>
          <li>填写投保人年龄、性别、是否吸烟及货币，可点击查看各档位<strong>入市奖赏（开户奖赏）比例</strong>。</li>
          <li>在实盘组合「持仓与表现」图表右上角开启「<strong>应用 ILP</strong>」：
            <ul>
              <li>🟢 <strong>原始市值曲线</strong> vs 🟣 <strong>ILP 净值曲线</strong>（期初计入开户奖赏，随后逐月扣减前期费 / 户口价值费 / COI，账户价值 ≥ 保额后 COI 自动归零，第 6 年起计入长期客户奖赏）。</li>
              <li>下方 KPI 面板直接展示：🎁 开户奖赏金额、历史年化（原始 vs ILP）及 <strong>ILP 净值拖累（%）</strong>。</li>
            </ul>
          </li>
        </ol>
      </>
    ),
  },
  {
    id: 'ch7',
    icon: <FileText size={16} />,
    titleZh: '第7章：双版本财富报告生成与导出',
    titleEn: 'Ch.7: Wealth Report & Client Brief Export',
    content: () => (
      <>
        <p>完成策略实验室蒙特卡洛测试后，系统提供<strong>两种报告版本</strong>，满足专业留档与客户沟通的不同场景：</p>

        <h4>7.1 客户简报版报告（Client Brief Report）</h4>
        <ol>
          <li>在蒙特卡洛操作栏点击「<strong>📄 预览客户版报告</strong>」，填写客户姓名、年龄等基础信息。</li>
          <li>该版本专为<strong>非投资专业背景客户</strong>设计，自动去除艰深金融术语，以清晰直观的图表与通俗语言呈现资产配置思路、现金流规划与保障底座。</li>
        </ol>

        <h4>7.2 完整专业财富报告（Wealth Report）与 Word 导出</h4>
        <ol>
          <li>点击「<strong>预览报告</strong>」或「<strong>生成 Word 报告</strong>」打开完整报告视图。</li>
          <li>报告内容完整涵盖：
            <ul>
              <li>组合资产配置明细与风险收益指标</li>
              <li>蒙特卡洛 10,000 次仿真结果与退休成功率</li>
              <li><strong>两阶段提取计划表</strong>（前 5 年连续展示，之后每 5 年间隔展示，含累计提取金额列）</li>
              <li><strong>第四章净值预估里程碑</strong>（每 10 年展示一次关键里程碑节点）</li>
              <li><strong>动态增配法则</strong>（解释资产规模扩大后适度增配保险底座的必要性）</li>
              <li><strong>后续持续陪伴承诺声明</strong>（动态再平衡监控与每半年深度复盘）</li>
            </ul>
          </li>
          <li>支持直接在浏览器打印/导出 <strong>PDF</strong>（导出时自动隐藏网页预览提示栏），或点击「<strong>⬇️ 下载 Word 报告</strong>」生成 <code>.docx</code> 文件进行二次排版编辑。</li>
        </ol>
      </>
    ),
  },
  {
    id: 'ch8',
    icon: <Activity size={16} />,
    titleZh: '第8章：组合持续监控大盘与顾问/管理功能',
    titleEn: 'Ch.8: Monitor Overview, Advisor & Admin',
    content: () => (
      <>
        <h4>8.1 跨组合持续监控看板（Monitor Overview）</h4>
        <p>点击左侧「<strong>🛡️ 組合監控</strong>」，一站式掌握所有纳管实盘组合的实时健康状态：</p>
        <ul>
          <li><strong>每日宏观与核心商品价格脉冲</strong>：实时展示美债 10Y 殖利率、10Y-3M 曲线斜率、SPY 5Y 估值分位、COMEX 黄金、WTI 原油、铜金比及当前宏观 Regime 标签。</li>
          <li><strong>全局 KPI 汇总</strong>：纳管组合总数、触发预警/需关注组合数、待确认执行草稿单数量、已体检平均健康分。</li>
          <li><strong>快速体检与跳转</strong>：在下方组合列表中可直接点击单组合的「快速体检」，或一键进入该组合的「持續追蹤與再評估」页面处理再平衡草稿单。</li>
        </ul>

        <h4>8.2 顾问专属：客户管理（Advisor / Admin 可见）</h4>
        <ul>
          <li>进入左侧「<strong>我的客户 / 顾问客户管理</strong>」，查看名下所有已绑定客户（姓名、邮箱与名下组合）。</li>
          <li>支持直接为指定客户创建关联组合、发起智能配置规划，客户使用自己账号登录后即可同步查看专属组合。</li>
        </ul>

        <h4>8.3 管理员专属：用户管理（Admin 可见）</h4>
        <ul>
          <li>进入左侧「<strong>👥 用户管理</strong>」，查看全平台注册用户列表。</li>
          <li>支持一键调整用户角色权限（<code>free</code> ↔ <code>premium</code> ↔ <code>advisor</code> ↔ <code>admin</code>）。</li>
        </ul>
      </>
    ),
  },
  {
    id: 'glossary',
    icon: <Search size={16} />,
    titleZh: '附录：核心金融与系统名词解释',
    titleEn: 'Appendix: Financial & System Glossary',
    content: () => (
      <>
        <table className="hm-table">
          <thead>
            <tr>
              <th>名词 / 缩写</th>
              <th>全称</th>
              <th>通俗解释</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>NAV</td><td>Net Asset Value</td><td>组合净资产价值（当前总市值）</td></tr>
            <tr><td>CAGR</td><td>Compound Annual Growth Rate</td><td>复合年化增长率，衡量长期复利速度</td></tr>
            <tr><td>TWR</td><td>Time-Weighted Return</td><td>时间加权收益率，剔除资金进出干扰的真实策略表现</td></tr>
            <tr><td>Sharpe</td><td>Sharpe Ratio</td><td>夏普比率，每承担 1 单位风险获得的超额回报</td></tr>
            <tr><td>YOC</td><td>Yield on Cost</td><td>成本股息率（当前年分红 ÷ 初始投入本金）</td></tr>
            <tr><td>DGR</td><td>Dividend Growth Rate</td><td>分红复合增长率，衡量被动收入抗通胀能力</td></tr>
            <tr><td>DRIP</td><td>Dividend Reinvestment Plan</td><td>分红自动再投资，利用复利滚雪球</td></tr>
            <tr><td>P10 / P50 / P90</td><td>Percentile Paths</td><td>蒙特卡洛悲观 / 中性 / 乐观百分位路径</td></tr>
            <tr><td>CMA</td><td>Capital Market Assumptions</td><td>资本市场长期收益假设校准模型</td></tr>
            <tr><td>X-Ray</td><td>Portfolio X-Ray</td><td>组合透视，穿透底层持仓查看行业与区域分布</td></tr>
            <tr><td>ILP / ILAS</td><td>Investment-Linked Assurance Scheme</td><td>投资相连寿险（投连险），含开户奖赏与 COI 扣费机制</td></tr>
            <tr><td>COI</td><td>Cost of Insurance</td><td>保险成本（按投保人年龄、性别与吸烟状况逐月扣减）</td></tr>
            <tr><td>Core-Satellite</td><td>核心-卫星架构</td><td>以稳健大盘/债券为核心底座、少量主题/高弹性资产作卫星增强</td></tr>
          </tbody>
        </table>
      </>
    ),
  },
];

const HelpManualView = () => {
  const { lang, t } = useLang();
  const [openChapters, setOpenChapters] = useState({ ch0: true });

  const toggle = (id) => setOpenChapters((prev) => ({ ...prev, [id]: !prev[id] }));

  const expandAll = () => {
    const next = {};
    chapters.forEach((ch) => { next[ch.id] = true; });
    setOpenChapters(next);
  };

  const collapseAll = () => setOpenChapters({});

  return (
    <div className="help-manual">
      {/* Header */}
      <div className="hm-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <BookOpen size={28} style={{ color: '#818cf8' }} />
          <div>
            <h1 className="hm-title">PortfolioHub (FIS) 用户操作手册</h1>
            <p className="hm-subtitle">v2.0 · 2026年11月 · 全面覆盖新版实盘透视、基金量化库、AI 智能投顾与持续监控</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={expandAll} className="action-btn-secondary" style={{ fontSize: '0.76rem', padding: '5px 10px' }}>
            全部展开
          </button>
          <button type="button" onClick={collapseAll} className="action-btn-secondary" style={{ fontSize: '0.76rem', padding: '5px 10px' }}>
            全部收起
          </button>
        </div>
      </div>

      {/* Quick start callout */}
      <div className="hm-quickstart">
        <div className="hm-quickstart-title">🚀 三大核心使用路径</div>
        <div className="hm-paths" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          <div className="hm-path-card advisor">
            <strong>🧑‍💼 顾问全流程服务线</strong>
            <span>为客户定制方案、配置保险并交付专业报告</span>
            <code>智能配置(Step1→2+AI) → 策略实验室 → 保险/ILP → 客户版/Word报告</code>
          </div>
          <div className="hm-path-card personal">
            <strong>💡 个人自用理财线</strong>
            <span>盘点个人持仓、筛选高分基金并测算退休现金流</span>
            <code>实盘组合(录入/X-Ray) → 基金库(对比) → 实验室(经典组合+蒙特卡洛)</code>
          </div>
          <div className="hm-path-card advisor" style={{ borderLeftColor: 'var(--success)' }}>
            <strong>🛡️ 投后持续监控线</strong>
            <span>跟踪宏观脉冲、组合健康度与再平衡执行</span>
            <code>组合监控大盘 → 宏观/商品脉冲 → 单组合体检 → 生成调仓草稿单</code>
          </div>
        </div>
      </div>

      {/* Chapters */}
      <div className="hm-chapters">
        {chapters.map((ch) => (
          <div key={ch.id} className={`hm-chapter ${openChapters[ch.id] ? 'open' : ''}`}>
            <button type="button" className="hm-chapter-header" onClick={() => toggle(ch.id)}>
              <span className="hm-chapter-icon">{ch.icon}</span>
              <span className="hm-chapter-title">{lang === 'en' ? ch.titleEn : ch.titleZh}</span>
              {openChapters[ch.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {openChapters[ch.id] && (
              <div className="hm-chapter-body">{ch.content(t)}</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="hm-footer">
        <p>如有功能更新，请以系统实际界面为准 · © Wonder Wisdom.</p>
      </div>
    </div>
  );
};

export default HelpManualView;
