/**
 * sopPromptBuilder.js
 * 单只/批量待分析基金の一键大模型 SOP v2.0 提示词生成器（自动聚合用户与管理员关注事项）
 */

const PRIORITY_LABEL = {
  P0_urgent: 'P0 紧急',
  P1_high: 'P1 高优',
  normal: '普通',
};

/**
 * 提取并去重单只基金的所有关注事项（用户标记备注 + 管理员调度备注 + 额外补充）
 */
export function extractWatchFocusList(item = {}, options = {}) {
  const focusList = [];
  const seen = new Set();

  const pushClean = (text) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    // 去重比较时忽略前缀冒号后的重复正文
    const core = clean.includes('：') ? clean.split('：').slice(1).join('：').trim() : clean;
    if (!seen.has(clean) && !seen.has(core)) {
      seen.add(clean);
      if (core) seen.add(core);
      focusList.push(clean);
    }
  };

  if (Array.isArray(item.requesters)) {
    for (const req of item.requesters) {
      const note = String(req?.note || '').trim();
      if (!note) continue;
      const who = String(req?.name || req?.email || '').trim();
      pushClean(who ? `【用户关注 · ${who}】：${note}` : `【用户关注】：${note}`);
    }
  }

  if (Array.isArray(item.research_notes)) {
    for (const rn of item.research_notes) {
      pushClean(rn);
    }
  }

  if (Array.isArray(item.notes)) {
    for (const n of item.notes) {
      pushClean(n);
    }
  }

  if (item.my_note && String(item.my_note).trim()) {
    pushClean(`【我的关注备注】：${String(item.my_note).trim()}`);
  }

  const adminNote =
    options.adminNoteOverride !== undefined
      ? options.adminNoteOverride
      : (item.admin_note ?? item.research_admin_note ?? '');
  if (adminNote && String(adminNote).trim()) {
    pushClean(`【管理员调度备注】：${String(adminNote).trim()}`);
  }

  if (options.extraFocus && String(options.extraFocus).trim()) {
    pushClean(`【补充核查要求】：${String(options.extraFocus).trim()}`);
  }

  return focusList;
}

/**
 * 为单只待分析基金生成完整的 SOP v2.0 大模型执行 Prompt
 */
export function buildSingleFundSopPrompt(item = {}, options = {}) {
  const slug = String(item.slug || item.code || 'UNKNOWN').trim();
  const code = String(item.code || slug).trim();
  const fundName = String(item.fund_name || item.name || slug).trim();
  const assetClass = String(item.asset_class || '待核实').trim();
  const platform = String(item.ilas_platform || '通用/待核实').trim();
  const priorityRaw = item.priority || item.research_priority || 'normal';
  const priorityLabel = PRIORITY_LABEL[priorityRaw] || priorityRaw;
  const reqCount = Number(item.request_count || item.research_request_count || 1);

  const extraIds = [
    item.isin ? `ISIN: ${item.isin}` : '',
    item.yahoo_ticker ? `Yahoo/MS: ${item.yahoo_ticker}` : '',
    item.aia_code && item.aia_code !== code ? `AIA: ${item.aia_code}` : '',
    item.twin_code ? `孪生份额: ${item.twin_code}` : '',
  ].filter(Boolean);

  const focusList = extractWatchFocusList(item, options);
  const focusBlock =
    focusList.length > 0
      ? focusList.map((f, idx) => `${idx + 1}. ${f}`).join('\n')
      : [
          '1. 【底层费率与 TCO 穿透】：核查显性 TER、换手摩擦、平台或保单层费用及是否存在内部嵌套基金双重收费；',
          '2. 【历史估值与利差水位 (FV1–FV4)】：量化 5Y/10Y 历史估值分位（或债基净 YTM / 保守净 YTW 相对 10Y 国债无风险利差与久期盈亏平衡点）；',
          '3. 【派息真实性与 ROC 排雷】：拆解账面派息率 vs 底层真实净收益率，排查是否存在资本返还（ROC）侵蚀净值；',
          '4. 【份额优选与被动替代检验】：对比孪生累积/分派份额经济性，并检验能否用更低费率的场内 ETF 替代。',
        ].join('\n');

  return `请按照 \`fund-analysis-sop\`（单只基金深度研究框架 SOP v2.0），分析基金 **${code}**（系统 Slug：\`${slug}\`，名称：${fundName}），并在报告中专项核查与回应以下关注事项：

### 一、目标基金基本档案
- **系统 Slug**：\`${slug}\`
- **基金代码**：\`${code}\`${extraIds.length > 0 ? `（${extraIds.join(' ｜ ')}）` : ''}
- **基金名称**：${fundName}
- **资产大类 / 所属平台**：${assetClass} / ${platform}
- **队列优先级 / 关注热度**：${priorityLabel}（共 ${reqCount} 人标记关注）

### 二、重点关注事项与研究焦点（须在 A 稿对应章节及 B 稿决策树中专项核查并给出量化结论）
${focusBlock}

### 三、SOP v2.0 六阶段标准化执行要求（Stage A – Stage F）
1. **Stage A（分诊与双核采集）**：
   - 锁定双重路由 \`fund_type (ETF/ACTIVE/CEF/BOND_MMF) × val_route (FV1–FV4)\`；
   - 运行 \`scripts/fetch_fund_data.py\` 与 \`scripts/calc_fund_metrics.py --render-charts-dir 05_Investment_Research/03_Funds/${code}/charts\` 冻结 \`FUND-FIN\` / \`FUND-VAL\` 快照；
   - 渲染并视觉核验历史估值 Band 图与分红收益率对比双图 PNG，落盘 \`资料溯源台账.md\`、\`.review/raw_facts_pack.md\` 与 \`${code}-基金一页纸-{YYYYMMDD}.md\`。
2. **Stage B–D（A 稿商业分析）**：
   - 撰写 \`05_Investment_Research/03_Funds/${code}/${code}-基金商业分析-{YYYYMMDD}.md\`（\`edition: commercial\`，含 5 个 \`FUND_TAB\` 锚点、G1–G5 硬门槛、晨星 2026 五支柱评分、六大价值大师审问矩阵、恰好 \`1🔴 + 1–2🟡\` 红队风险，严格遵守零买卖指令合规红线）；
   - 对上方【二、重点关注事项与研究焦点】逐一提供一手数据与量化回答。
3. **Stage E（B 稿内部决策）**：
   - 撰写 \`05_Investment_Research/03_Funds/${code}/${code}-基金估值与投资决策-{YYYYMMDD}.md\`（\`edition: internal_valuation\`，含四层漏斗准出裁决、孪生份额与低费 ETF 被动替代检验、Plan A–D 量化触发行动树及组合单仓上限）。
4. **Stage F（5 核隔离复核、机械验收与线上生产推送闭环）**：
   - 并行派生 5 个隔离 \`research\` 子 Agent 独立挑刺复核，现场修正算术与口径问题并落盘 \`.review/${code}-独立校验-{YYYYMMDD}.md\`；
   - 运行 \`scripts/check_fund_contract.py 05_Investment_Research/03_Funds/${code}\` 确保 **0 errors PASS**；
   - 运行 \`scripts/sync_fund_to_library.py --slug ${slug} --report-dir 05_Investment_Research/03_Funds/${code}\` 回写产品库并通过 \`render_preview.py\` 8/8 校验；
   - **强制执行线上生产推送**：运行 \`& "D:\\Projects\\Wonder Platform\\tools\\wonder-quant\\.venv\\Scripts\\python.exe" -m wonder_quant.cli publish-sop ${slug} --report-dir 05_Investment_Research/03_Funds/${code}\`，确认远端 Cloudflare D1 返回 \`"published": true\`。`;
}

/**
 * 为多只待分析队列基金生成批量 SOP v2.0 调度 Prompt
 */
export function buildBatchFundSopPrompt(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  if (items.length === 1) {
    return buildSingleFundSopPrompt(items[0]);
  }

  const lines = items.map((it, idx) => {
    const slug = String(it.slug || it.code || '').trim();
    const code = String(it.code || slug).trim();
    const name = String(it.fund_name || it.name || slug).trim();
    const prio = PRIORITY_LABEL[it.priority || it.research_priority || 'normal'] || (it.priority || '普通');
    const cnt = Number(it.request_count || it.research_request_count || 1);
    const focus = extractWatchFocusList(it);
    const focusStr = focus.length > 0 ? focus.join('；') : '常规 SOP v2.0 全维度深度体检（TCO/估值分位/分红ROC排雷/替代品检验）';
    return `${idx + 1}. **${code}**（Slug: \`${slug}\` · ${name}）｜ 优先级：${prio}（${cnt}人关注）\n   - **重点关注事项**：${focusStr}`;
  });

  return `请按照 \`fund-analysis-sop\`（单只基金深度研究框架 SOP v2.0），按优先级依次对以下 ${items.length} 只 FIS 观察分析队列基金执行 Stage A – Stage F 全链路深度研究，并在报告中专项回应各只基金的【重点关注事项】：

### 待分析基金队列与重点关注事项
${lines.join('\n\n')}

### 每只基金强制交付与线上发布闭环（Stage A – Stage F）
- 冻结 \`FUND-FIN\` / \`FUND-VAL\` 快照并渲染估值 Band 图 + 分红对比双图 PNG；
- 落盘 A 稿商业分析（5 个 \`FUND_TAB\` 锚点、零买卖指令词）、B 稿内部决策（Plan A–D 量化树）、基金一页纸、资料溯源台账与 5 核隔离独立校验报告；
- 依次运行 \`check_fund_contract.py\`（0 errors PASS）、\`sync_fund_to_library.py\`（8/8 通过）与 \`publish-sop <SLUG>\` 直推远端 Cloudflare D1 生产库（确认返回 \`"published": true\`）。`;
}

/**
 * 浏览器端一键复制并可选下载 Prompt Markdown 文件
 */
export async function copyAndDownloadSopPrompt(promptText, filename, { download = false } = {}) {
  let copied = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(promptText);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (download && typeof document !== 'undefined') {
    const blob = new Blob([promptText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `基金SOP分析Prompt-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { copied, downloaded: Boolean(download) };
}
