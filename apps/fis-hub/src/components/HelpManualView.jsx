import React, { useState } from 'react';
import { useLang } from '../i18n/langCore';
import { ChevronDown, ChevronRight, BookOpen, Monitor, BarChart3, FlaskConical, Shield, Link2, FileText, Users, Search } from 'lucide-react';

/**
 * HelpManualView — 内嵌操作手册，用户登录后即可阅读
 */

const chapters = [
  {
    id: 'ch0', icon: <Monitor size={16}/>, titleZh: '第0章：认识系统', titleEn: 'Ch.0: System Overview',
    content: () => (<>
      <table className="hm-table"><thead><tr><th>模块</th><th>功能</th><th>回答的核心问题</th></tr></thead><tbody>
        <tr><td>📊 Live Portfolio</td><td>实盘组合管理</td><td>我的资产现在值多少？赚了多少？</td></tr>
        <tr><td>🧪 Strategy Lab</td><td>量化策略实验室</td><td>我该怎么配置？未来够不够花？</td></tr>
        <tr><td>📄 Wealth Report</td><td>一键财富报告</td><td>如何把分析结果交给客户/自己留档？</td></tr>
      </tbody></table>
      <h4>角色权限一览</h4>
      <table className="hm-table"><thead><tr><th>角色</th><th>颜色</th><th>可用功能</th></tr></thead><tbody>
        <tr><td>admin</td><td>🔴 红色</td><td>全部功能 + 用户管理</td></tr>
        <tr><td>advisor</td><td>🔵 蓝色</td><td>全部功能 + 客户管理</td></tr>
        <tr><td>premium</td><td>🟡 金色</td><td>含策略实验室</td></tr>
        <tr><td>free</td><td>⚫ 灰色</td><td>仅基础组合查看，策略实验室锁定</td></tr>
      </tbody></table>
      <div className="hm-callout warn">⚠️ <strong>策略实验室</strong>是本系统最核心的功能，需要 premium 以上权限。</div>
      <h4>界面布局</h4>
      <pre className="hm-code">{`┌──────────────────────────────────────────┐
│  顶部导航：登录状态 · 语言切换             │
├──────────┬───────────────────────────────┤
│          │                               │
│  左侧边栏 │       右侧主内容区              │
│          │                               │
│ 📊 组合   │  （组合仪表板 / 策略实验室 /    │
│ 🧪 实验室 │   客户管理 / 报告预览）         │
│ 🔗 ILP   │                               │
└──────────┴───────────────────────────────┘`}</pre>
    </>),
  },
  {
    id: 'ch1', icon: <BookOpen size={16}/>, titleZh: '第1章：登录与权限确认', titleEn: 'Ch.1: Login & Permissions',
    content: () => (<>
      <h4>Step 1.1 · 注册账号</h4>
      <ol><li>进入系统首页，点击右上角「<strong>登录</strong>」按钮</li><li>切换到「注册」标签，填写姓名、邮箱、密码（至少6位）</li><li>提交后检查邮箱，点击验证链接完成激活</li></ol>
      <h4>Step 1.2 · 登录</h4>
      <ol><li>填写邮箱 + 密码，点击「登录」</li><li>登录成功后，右上角显示你的名字和角色标签（颜色标识角色）</li><li>首次进入会弹出<strong>合规声明弹窗</strong>，阅读后点击确认</li></ol>
      <div className="hm-callout info">💡 合规声明是合规要求，清除浏览器缓存后会再次弹出，属正常现象。</div>
      <h4>Step 1.3 · 确认权限</h4>
      <ul><li>角色标签为<strong>金色 Premium</strong> 或<strong>蓝色 Advisor</strong>：可使用全部功能</li><li>为<strong>灰色 Free</strong>：策略实验室入口显示锁定图标，需联系管理员升级</li></ul>
      <h4>Step 1.4 · 忘记密码</h4>
      <ol><li>点击「登录」→「忘记密码」</li><li>输入注册邮箱，点击发送</li><li>收到重置邮件后，点击链接设置新密码</li></ol>
    </>),
  },
  {
    id: 'ch2', icon: <BarChart3 size={16}/>, titleZh: '第2章：建立实盘组合', titleEn: 'Ch.2: Create Portfolio',
    content: () => (<>
      <div className="hm-dual"><span className="hm-tag advisor">🧑‍💼 顾问线</span>为客户创建存量资产组合<span className="hm-tag personal">💡 个人线</span>录入自己持有的资产，看清家底</div>
      <h4>Step 2.1 · 新建组合</h4>
      <p>点击左侧边栏「<strong>＋ 新建策略</strong>」，填写：</p>
      <table className="hm-table"><thead><tr><th>字段</th><th>顾问线</th><th>个人线</th></tr></thead><tbody>
        <tr><td>组合名称</td><td>客户存量资产</td><td>我的资产组合</td></tr>
        <tr><td>计价货币</td><td>HKD</td><td>HKD 或 USD</td></tr>
        <tr><td>初始资金</td><td>400,000</td><td>实际持仓总市值</td></tr>
        <tr><td>分红策略</td><td>CASH（分红到账）</td><td>CASH 或 DRIP</td></tr>
      </tbody></table>
      <h4>Step 2.2 · 录入持仓</h4>
      <p>在「初始配置」中填入各资产代码和权重，合计须 = 100%。</p>
      <h4>资产代码格式</h4>
      <table className="hm-table"><thead><tr><th>市场</th><th>格式</th><th>示例</th></tr></thead><tbody>
        <tr><td>美股ETF</td><td>直接输入</td><td>VOO, LQD, QQQ</td></tr>
        <tr><td>港股</td><td>代码.HK</td><td>0005.HK, 0700.HK</td></tr>
        <tr><td>A股</td><td>代码.SS 或 .SZ</td><td>600519.SS</td></tr>
      </tbody></table>
      <div className="hm-callout warn">⚠️ 权重合计须 = 100%，系统会实时显示当前总和是否达标。</div>
    </>),
  },
  {
    id: 'ch3', icon: <BarChart3 size={16}/>, titleZh: '第3章：组合日常管理', titleEn: 'Ch.3: Daily Management',
    content: () => (<>
      <h4>3.1 绩效标签页</h4>
      <table className="hm-table"><thead><tr><th>指标</th><th>含义</th><th>参考意义</th></tr></thead><tbody>
        <tr><td>资产市值</td><td>当前持仓总市值</td><td>组合现在值多少</td></tr>
        <tr><td>累计收益率</td><td>相对初始投入的总回报%</td><td>历史总赚了多少</td></tr>
        <tr><td>总分红</td><td>累计收到的分红现金</td><td>被动收入总额</td></tr>
        <tr><td>年化回报 CAGR</td><td>复合年化增长率</td><td>最重要的效率指标</td></tr>
      </tbody></table>
      <h4>3.2 收益标签页（分红分析）</h4>
      <ul><li><strong>预扣税率</strong>：港股选 Gross 0%，美股选 US 30%</li><li><strong>DRIP 模式</strong>：开启模拟分红再投资，关闭模拟分红取现</li></ul>
      <h4>3.3 交易管理</h4>
      <p>点击「交易管理」→ 新增/编辑/删除交易记录。</p>
      <h4>3.4 Rebalance 再平衡</h4>
      <ol><li>设置目标权重</li><li>点击「计算预览」查看买卖清单</li><li>确认无误后「执行再平衡」</li><li>如需撤销：点击「↩ 撤销」</li></ol>
      <h4>3.5 手动补录分红</h4>
      <p>点击「+ 录入分红」→ 选资产 → 填日期和每股分红金额。</p>
      <h4>3.6 数据导出</h4>
      <p>右上角菜单可导出持仓快照 CSV 和分红历史 CSV。</p>
    </>),
  },
  {
    id: 'ch4', icon: <FlaskConical size={16}/>, titleZh: '第4章：策略实验室 ★', titleEn: 'Ch.4: Strategy Lab ★',
    content: () => (<>
      <div className="hm-callout warn">⚠️ 需要 premium 或以上权限。free 用户会看到锁定遮罩。</div>
      <h4>4.1 配置资产组合</h4>
      <ul><li>在输入框填入资产代码，按 Enter 添加</li><li>每张卡片下方填写权重（%），合计须等于 100%</li><li>可一键套用模板：All-Weather / 60/40 / Golden Butterfly</li></ul>
      <div className="hm-callout info">💡 回测周期：目前数据源限制，建议选 <strong>5年</strong>，数据最完整。10年/15年部分资产数据可能不足。</div>
      <h4>4.2 运行分析</h4>
      <p>点击「⚡ 运行分析」，系统约3-5秒完成计算。</p>
      <h4>4.3 优化分析标签页</h4>
      <table className="hm-table"><thead><tr><th>指标</th><th>含义</th><th>判读</th></tr></thead><tbody>
        <tr><td>年化回报率</td><td>历史年化收益</td><td>越高越好，需结合波动率</td></tr>
        <tr><td>波动率</td><td>回报标准差</td><td>越低越稳定</td></tr>
        <tr><td>夏普比率</td><td>每单位风险的超额回报</td><td>&gt;1 良好，&gt;2 优秀</td></tr>
        <tr><td>MC中位数终值</td><td>蒙特卡洛P50期末资产</td><td>中性预期终值</td></tr>
        <tr><td>退休成功率</td><td>未被提完的路径比例</td><td>&gt;80% 绿 · 50-80% 黄 · &lt;50% 红</td></tr>
      </tbody></table>
      <h4>4.4 蒙特卡洛退休规划仿真 ★★</h4>
      <div className="hm-highlight">这是系统最重要的功能，回答「按这个配置，能不能按时退休？」</div>
      <table className="hm-table"><thead><tr><th>参数</th><th>顾问线</th><th>个人线</th></tr></thead><tbody>
        <tr><td>初始资本</td><td>200,000 HKD</td><td>当前可投入金额</td></tr>
        <tr><td>年度追加</td><td>50,000 HKD（1-14年）</td><td>每年能存多少</td></tr>
        <tr><td>年度提取</td><td>250,000 HKD（15年起）</td><td>退休后每年取多少</td></tr>
        <tr><td>随通胀调整</td><td>✅ 勾选</td><td>建议勾选</td></tr>
        <tr><td>模拟年数</td><td>30</td><td>退休后寿命预期</td></tr>
      </tbody></table>
      <div className="hm-callout info">💡 <strong>典型问题</strong>：「我有50万，每年存10万，10年后想每年取20万，能撑多久？」<br/>→ 初始资本 500,000 / 年度追加 100,000（1-10年）/ 年度提取 200,000（11年起）/ 年数 30</div>
      <h4>三条情景线</h4>
      <table className="hm-table"><thead><tr><th>情景</th><th>含义</th></tr></thead><tbody>
        <tr><td>🟢 乐观 P90</td><td>最好的10%运气</td></tr>
        <tr><td>🟣 中性 P50</td><td>中位数预期（最重要参考）</td></tr>
        <tr><td>🔴 悲观 P10</td><td>最差的10%运气（压力测试）</td></tr>
      </tbody></table>
      <h4>4.5 分红追踪指标</h4>
      <table className="hm-table"><thead><tr><th>指标</th><th>含义</th></tr></thead><tbody>
        <tr><td>期末 YOC</td><td>期末分红 ÷ 初始本金，时间复利效果</td></tr>
        <tr><td>DGR</td><td>分红年化复利增速，抵抗通胀能力</td></tr>
        <tr><td>支出覆盖率</td><td>&gt;100% 纯靠分红即可生活</td></tr>
        <tr><td>零成本拐点</td><td>累计复投回本年数</td></tr>
      </tbody></table>
    </>),
  },
  {
    id: 'ch5', icon: <Shield size={16}/>, titleZh: '第5章：保险方案集成', titleEn: 'Ch.5: Insurance Integration',
    content: () => (<>
      <p>将储蓄险叠加进蒙特卡洛模型，测算保险底座对退休成功率的提升效果。</p>
      <h4>Step 5.1 · 开启保险模块</h4>
      <p>在蒙特卡洛面板 Block 2 中点击「开启保险」开关。</p>
      <h4>Step 5.2 · 准备 Excel 文件</h4>
      <table className="hm-table"><thead><tr><th>列名</th><th>内容</th></tr></thead><tbody>
        <tr><td>year</td><td>保单年度（1, 2, 3...）</td></tr>
        <tr><td>premium</td><td>当年应缴保费</td></tr>
        <tr><td>guaranteed_value</td><td>保证现金价值</td></tr>
        <tr><td>total_value</td><td>总现金价值（含分红）</td></tr>
        <tr><td>withdrawal</td><td>计划提取金额</td></tr>
      </tbody></table>
      <h4>Step 5.3 · 上传并调参</h4>
      <ul><li><strong>Alpha Low</strong>（默认0.80）：悲观假设</li><li><strong>Alpha High</strong>（默认1.20）：乐观假设</li></ul>
      <h4>Step 5.4 · 对比成功率</h4>
      <p>重新运行分析，对比加保险前后的成功率变化。</p>
    </>),
  },
  {
    id: 'ch6', icon: <Link2 size={16}/>, titleZh: '第6章：ILP 投连险分析', titleEn: 'Ch.6: ILP Analysis',
    content: () => (<>
      <h4>Step 6.1 · 开启 ILP 模式</h4>
      <p>在 Block 1 底部点击「🔗 通过投连险实现本组合」开关。开启后：</p>
      <ul><li>Initial Capital = 整付保费</li><li>Annual Add 自动锁定为 0</li></ul>
      <h4>Step 6.2 · 填写配置</h4>
      <ul><li>年龄、性别、是否吸烟、货币</li></ul>
      <h4>Step 6.3 · 查看入市奖赏</h4>
      <p>点击「查看入市奖赏」弹窗，查看奖赏比例。</p>
      <h4>Step 6.4 · NAV 对比</h4>
      <p>返回组合页面，开启「叠加 ILP 净值」查看两条曲线：</p>
      <ul><li>🟢 绿色：原始组合市值</li><li>🟣 紫色：ILP 净值（扣费后）</li></ul>
      <table className="hm-table"><thead><tr><th>数据项</th><th>含义</th></tr></thead><tbody>
        <tr><td>🎁 开户奖赏</td><td>期初计入的奖赏金额</td></tr>
        <tr><td>综合年化</td><td>原始组合 CAGR</td></tr>
        <tr><td>ILP 综合年化</td><td>扣费后净年化</td></tr>
        <tr><td>ILP 净值拖累</td><td>费用导致的损耗%</td></tr>
      </tbody></table>
    </>),
  },
  {
    id: 'ch7', icon: <FileText size={16}/>, titleZh: '第7章：生成财富报告', titleEn: 'Ch.7: Wealth Report',
    content: () => (<>
      <h4>Step 7.1 · 点击「📄 生成报告」</h4>
      <p>填写客户姓名、年龄，报告日期自动填入。</p>
      <h4>Step 7.2 · 预览报告</h4>
      <p>系统在页面内渲染完整报告，包含组合配置、蒙特卡洛结果、保险叠加效果、分红追踪指标。</p>
      <h4>Step 7.3 · 下载 Word 版本</h4>
      <p>点击「⬇️ 下载 Word 报告」，生成 .docx 文件，可在 Word 中进一步编辑。</p>
    </>),
  },
  {
    id: 'ch8', icon: <Users size={16}/>, titleZh: '第8章：顾问专属功能', titleEn: 'Ch.8: Advisor Features',
    content: () => (<>
      <div className="hm-callout info">本章功能仅对 advisor 和 admin 角色可见。</div>
      <h4>8.1 我的客户管理</h4>
      <ul><li>查看名下所有客户（姓名 + 邮箱）</li><li>为客户创建关联组合</li><li>客户登录后可在自己的界面查看组合数据</li></ul>
      <h4>8.2 用户管理（Admin）</h4>
      <ul><li>查看全平台注册用户</li><li>修改用户角色（free → premium → advisor）</li></ul>
    </>),
  },
  {
    id: 'glossary', icon: <Search size={16}/>, titleZh: '附录：名词解释', titleEn: 'Appendix: Glossary',
    content: () => (<>
      <table className="hm-table"><thead><tr><th>名词</th><th>全称</th><th>解释</th></tr></thead><tbody>
        <tr><td>NAV</td><td>Net Asset Value</td><td>组合净资产价值</td></tr>
        <tr><td>CAGR</td><td>Compound Annual Growth Rate</td><td>复合年化增长率</td></tr>
        <tr><td>IRR</td><td>Internal Rate of Return</td><td>内部收益率</td></tr>
        <tr><td>Sharpe</td><td>Sharpe Ratio</td><td>每承担1单位风险的超额回报</td></tr>
        <tr><td>YOC</td><td>Yield on Cost</td><td>成本股息率</td></tr>
        <tr><td>DGR</td><td>Dividend Growth Rate</td><td>分红复合增长率</td></tr>
        <tr><td>P10/P50/P90</td><td>Percentile</td><td>蒙特卡洛百分位路径</td></tr>
        <tr><td>DRIP</td><td>Dividend Reinvestment Plan</td><td>分红自动再投</td></tr>
        <tr><td>ILP</td><td>Investment-Linked Policy</td><td>投资联结险</td></tr>
        <tr><td>COI</td><td>Cost of Insurance</td><td>保险成本</td></tr>
      </tbody></table>
    </>),
  },
];

const HelpManualView = () => {
  const { t } = useLang();
  const [openChapters, setOpenChapters] = useState({ ch0: true });

  const toggle = (id) => setOpenChapters(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="help-manual">
      {/* Header */}
      <div className="hm-header">
        <BookOpen size={28} style={{ color: '#818cf8' }} />
        <div>
          <h1 className="hm-title">PortfolioHub 技术操作手册</h1>
          <p className="hm-subtitle">v1.0 · 2026年5月 · 点击章节标题展开阅读</p>
        </div>
      </div>

      {/* Quick start callout */}
      <div className="hm-quickstart">
        <div className="hm-quickstart-title">🚀 两条使用路径</div>
        <div className="hm-paths">
          <div className="hm-path-card advisor">
            <strong>🧑‍💼 顾问服务线</strong>
            <span>帮客户做完整财务规划</span>
            <code>登录 → 建组合 → 策略实验室 → 保险集成 → 生成报告</code>
          </div>
          <div className="hm-path-card personal">
            <strong>💡 个人自用线</strong>
            <span>自查资产健康度、测算未来现金流</span>
            <code>登录 → 录入资产 → 优化分析 → 蒙特卡洛测算</code>
          </div>
        </div>
      </div>

      {/* Chapters */}
      <div className="hm-chapters">
        {chapters.map(ch => (
          <div key={ch.id} className={`hm-chapter ${openChapters[ch.id] ? 'open' : ''}`}>
            <button className="hm-chapter-header" onClick={() => toggle(ch.id)}>
              <span className="hm-chapter-icon">{ch.icon}</span>
              <span className="hm-chapter-title">{ch.titleZh}</span>
              {openChapters[ch.id] ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
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
