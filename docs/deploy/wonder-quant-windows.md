# Wonder Quant · Windows 主机部署说明（v0.1 草案）

> 读者：Windows 主机（PC）上的 Agent
> 起草：Mac 端 Antigravity，2026-11-23
> 本轮任务：
> 1. 阅读本说明；
> 2. 按第 3 节做环境检查（只读）；
> 3. 把检查结果写进第 8 节；
> 4. 修订第 4–6 节中所有标了「待 PC 核实」的内容。
>
> 本轮**不要**编写 wonder-quant 代码，**不要**创建计划任务，**不要**改动 vault 中的任何文件。

## 1. 背景

在 Obsidian 基金产品库（PC vault 下的 `05_Investment_Research/03_Funds/00_基金产品库/`，共 309 只基金）和 FIS 平台（Cloudflare Worker + D1 + fis-hub）的基础上，新增基金组合的设计、跟踪与模拟功能。

- 新增 Python 包 `wonder-quant`（命令行工具名为 `wq`），放在 wonder_platform 仓库的 `tools/wonder-quant/` 下。代码由 Mac 端开发，PC 端只负责拉取代码并运行。
- PC 7×24 小时开机，承担以下工作：
  1. 获取基金净值、派息、汇率和参照指数数据；
  2. 批量计算指标；
  3. 通过 Cloudflare REST API 写入 D1；
  4. 把指标回写到 Obsidian 的独立指标文件中。
- Cloudflare Worker 的定时任务充当"看门狗"：如果数据超过 2 个工作日没有更新，就发出告警。
- 交互式的优化和模拟由 Worker 完成，不依赖 PC 是否在线。

## 2. 必须遵守的规则

| # | 规则 | 原因 |
|---|---|---|
| R1 | wonder-quant 不执行任何 git 操作。写入 vault 的文件，统一由现有的 WDR_Daily_Git_Archive（02:30 / 23:30）归档 | vault 规定同一个工作树只能有一个自动同步来源（见 vault CLAUDE.md §0.5） |
| R2 | 写入 vault 的时段要避开 23:00–00:00 和 02:00–03:00 | 防止归档时把写到一半的文件提交进去 |
| R3 | 只允许写 `funds/_quant/` 目录和 `_quant_metrics.json`；`funds/<slug>.md`、`_funds.json` 和索引一律不改 | 基金档案由人工维护 |
| R4 | 文件统一用 UTF-8（无 BOM）、LF 换行；写入时先写临时文件，再整体替换 | 现有档案已经出现换行混乱 |
| R5 | API Token 等凭据不得放进 vault，也不得放进 wonder_platform 仓库 | 这两个仓库都会推送到 GitHub |
| R6 | 外部数据源每天最多访问一次，严格遵守各自的使用条款；一旦访问被拒，立即停止并告警，改为手动导入 CSV | 合规，且保证访问稳定 |
| R7 | 不修改现有的计划任务、同步脚本或 hook | 避免影响现有工作流 |

## 3. 环境检查清单（只读，在 PowerShell 中执行）

每一项都要记录：实际输出摘要 + 结论（✅ / ⚠️ / ❌）+ 建议。

### 3.1 主机与电源
| 检查项 | 参考命令 | 期望 |
|---|---|---|
| 系统版本 | `Get-ComputerInfo OsName,OsVersion` | Win10 22H2+ / Win11 |
| 时区 | `Get-TimeZone` | China / HK (UTC+8) |
| 睡眠 / 休眠 | `powercfg /query SCHEME_CURRENT SUB_SLEEP` | 接通电源时永不睡眠 |
| 断电后自动开机 | 询问用户（BIOS 设置） | 记录即可 |
| Windows 更新活动时间 | 设置 → Windows 更新 → 活动时间 | 覆盖 18:00–08:00，避免夜间重启 |
| 磁盘余量 | `Get-PSDrive C,D` | 剩余 ≥ 20 GB |
| 长路径支持 | `Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem LongPathsEnabled` | 1（中文长路径需要） |

### 3.2 工具链
| 检查项 | 参考命令 | 期望 |
|---|---|---|
| Git | `git --version` | 有 |
| uv | `uv --version` | 有；没有则记录，**本轮不安装** |
| Python | `uv python list` 或 `py -0p` | 3.11 或 3.12 |
| Node / wrangler | `node -v`；`npx wrangler --version` | 可选，用于手动核对 D1 |
| 控制台编码 | `[Console]::OutputEncoding`；`chcp` | 记录（中文路径需要 UTF-8） |

### 3.3 仓库与 vault
| 检查项 | 参考命令 | 期望 |
|---|---|---|
| vault 路径与状态 | `git -C D:\Claude_Agent_Workspace\derek-obsidian-sync status --short` | 路径存在；记录未提交文件的数量 |
| 基金库目录 | `Test-Path <vault>\05_Investment_Research\03_Funds\00_基金产品库\funds` | True；记录 md 文件数量（应为 309） |
| wonder_platform 仓库 | 查找是否已经 clone（`helloaniuwu-wq/wonder_platform`） | 记录路径；没有就建议 clone 到 `D:\Claude_Agent_Workspace\wonder_platform` |
| 现有计划任务 | `Get-ScheduledTask \| ? TaskName -match 'WDR\|sync\|icloud\|git'` | 列出名称、触发时间、上次运行结果 |
| iCloud 镜像机制 | 阅读 vault `scripts/sync_to_icloud.py` 及其 hook 配置 | 确认脚本写入的文件**是否会被镜像**（hook 只在 Agent 编辑文件时触发）。如果不会，提出方案，例如运行完后调用一次该脚本 |

### 3.4 网络连通（每个只请求一次）
| 目标 | 参考命令 | 用途 |
|---|---|---|
| AIA 报价页 | `curl.exe -s -o NUL -w "%{http_code}" https://www.aia.com.hk/zh-hk/help-and-support/individuals/investment-information/investment-options-prices.html` | 平台基金净值 |
| Yahoo 行情 | `curl.exe -s "https://query1.finance.yahoo.com/v8/finance/chart/0P00006T5J?range=1mo&interval=1d"` | 0P 基金与 ETF 历史数据；记录返回的数据点数 |
| Cloudflare API | `curl.exe -s -o NUL -w "%{http_code}" https://api.cloudflare.com/client/v4/` | 写入 D1 |
| A 股 ETF 数据源 | 用户已有的 A 股数据工具（如 vault 中的投研脚本）能否正常使用 | A 股 ETF 净值 |
| 代理 / Tailscale | `Get-NetAdapter`；`tailscale status`（如已安装） | 记录是否会影响 DNS 或出口 IP |

### 3.5 凭据准备（只检查，不创建）
- 确认用户能否在 Cloudflare 控制台创建 **只授予 D1 编辑权限** 的 API Token（账号 ID、D1 `wonder-db` 的 ID 见仓库 `apps/api-worker/wrangler.toml`）。
- 建议存放位置：`D:\WonderQuant\.env`，并设置 NTFS 权限，只允许当前用户读取；也可以用 Windows 凭据管理器。请给出你的推荐方案。

## 4. 目标部署布局（初稿，标注「待 PC 核实」的部分需修订）

```
D:\Claude_Agent_Workspace\
├── derek-obsidian-sync\                 ← vault（已存在，Git 权威源）
│   └── 05_Investment_Research\03_Funds\00_基金产品库\
│       ├── funds\<slug>.md              ← 只读，wq 绝不修改
│       ├── funds\_quant\<slug>.md       ← wq 生成：量化体检（frontmatter 的 q_* 字段 + 正文）
│       └── _quant_metrics.json          ← wq 生成：全库指标汇总
└── wonder_platform\                     ← 代码仓库（待 PC 核实是否已存在）
    └── tools\wonder-quant\              ← Mac 端开发后由 PC 端 git pull

D:\WonderQuant\                          ← 运行目录（不在任何 Git 仓库内）
├── .env                                 ← 凭据（仅当前用户可读）
├── cache\                               ← 原始抓取数据（parquet 格式，可随时重建）
├── state\                               ← 上次运行状态、断点续跑标记
└── logs\                                ← 按日滚动，保留 60 天
```

- Python 环境：在 `tools\wonder-quant` 目录下执行 `uv sync`，生成项目自带的 `.venv`，不安装到全局。
- 代码更新：由用户或 Agent 手动执行 `git pull`，**计划任务不会自动拉取代码**，避免把未经验证的代码直接投入运行。

## 5. 运行流程与时间表（初稿，待 PC 核实）

| 计划任务 | 时间（UTC+8） | 内容 | 说明 |
|---|---|---|---|
| `WQ_Daily_Data` | 周二至周六 08:30 | `wq fetch` → `wq compute` → `wq push-d1` | 此时美股前一交易日已收盘，AIA 前一估值日价格已发布（**待 PC 核实 AIA 的实际更新时间**） |
| `WQ_Vault_Writeback` | 每天 01:30 | `wq writeback` | 避开 23:30 和 02:30 两次归档；只写 `_quant` |
| `WQ_Heartbeat` | 每小时 | 向 D1 写入心跳时间戳 | Worker 看门狗据此判断 PC 是否在线 |

计划任务的通用设置：
- 不管用户是否登录都要运行；
- 错过计划时间后尽快补跑；
- 单次运行超过 2 小时自动终止；
- 失败后每 30 分钟重试一次，最多 3 次。

**同步链路**：PC 的 `_quant` 文件 → 23:30 / 02:30 WDR 归档推送到 GitHub → Mac 执行 `git pull` 后在 Obsidian 中看到。iCloud 镜像是否会包含这些文件，以 3.3 节的检查结果为准。

## 6. 告警（初稿）
- 告警通道：**待 PC 核实**用户现有的渠道，例如邮件、企业微信、Telegram、Bark。推荐复用 Worker 已有的邮件能力，由 Worker 看门狗统一发出。
- 告警触发条件：
  - 抓取失败率超过 20%；
  - 某个数据源整体不可用；
  - D1 写入失败；
  - 心跳中断超过 6 小时；
  - 计算结果超出合理区间，例如单日净值变动超过 15%。

## 7. 本轮交付要求（给 PC Agent）

1. **只修改本文件**：在第 8 节填写检查报告，并直接修订第 4–6 节（修改处标注 `【PC 修订】`）。
2. 文件位置：本文件在 wonder_platform 仓库的 `docs/deploy/wonder-quant-windows.md`。如果 PC 上没有这个仓库，先在 vault 的 `00_Inbox/` 中写一份同名报告，并告诉用户。
3. 按 vault 规则，在 `01_Journal/Agent工作纪要/跨Agent协同与规则同步台账.md` 中追加一条 `MSG-YYYYMMDD-NNN` 交接记录，写明检查结论和需要 Mac 端跟进的事项。
4. 遇到需要用户决定的问题（例如安装软件、创建 Token、调整 BIOS 或电源设置），**列入第 8 节的"待用户确认"清单，不要自行执行**。

## 8. 环境检查报告（由 PC Agent 填写）

> 检查时间：
> 检查者：
> 总体结论：✅ 可部署 / ⚠️ 需先处理 N 项 / ❌ 不适合部署

### 8.1 检查结果
| 编号 | 检查项 | 实际结果 | 结论 | 建议 |
|---|---|---|---|---|
| 3.1-1 | 系统版本 | | | |

### 8.2 对部署方案的修订建议

### 8.3 待用户确认
- [ ]

### 8.4 需要 Mac 端跟进的事项
- [ ]
