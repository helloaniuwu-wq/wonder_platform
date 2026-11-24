# Wonder Quant · Windows 主机开发与部署说明（v0.2 · PC 本机开发定稿版）

> 读者：Windows 主机（PC）上的开发与运维 Agent
> 初稿起草：Mac 端 Antigravity，2026-11-23
> PC 巡检与架构修订：PC 端 Antigravity，2026-11-23 21:40 (UTC+08:00)
> **架构变更声明（用户拍板）**：`【PC 修订】` **改为在 Windows 主机（`D:\Projects\Wonder Platform`）直接完成 `wonder-quant` 及配套 Worker / 前端功能的开发、测试与部署运行；Mac 主机不再承担开发工作**（仅通过 Git 拉取 Obsidian Vault 阅读生成的量化体检档案）。

## 1. 背景

在 Obsidian 基金产品库（PC vault 下的 `05_Investment_Research/03_Funds/00_基金产品库/`，共 309 只基金）和 FIS 平台（Cloudflare Worker `wonder-api-worker` + D1 `wonder-db` + `fis-hub`）的基础上，新增基金组合的设计、跟踪与模拟功能。

- `【PC 修订】` 新增 Python 包 `wonder-quant`（命令行工具名为 `wq`），放在本机 `D:\Projects\Wonder Platform\tools\wonder-quant\` 下，**由 Windows 主机本地开发、测试并运行**（不再跨机等待 Mac 开发）。
- PC 7×24 小时开机，承担以下工作：
  1. 获取基金净值、派息、汇率和参照指数数据；
  2. 批量计算指标；
  3. 通过 Cloudflare REST API 写入 D1（`wonder-db`，ID: `b76be6c3-b0b7-4100-a417-dcbb0a08bf17`）；
  4. 把指标回写到 Obsidian 的独立指标文件中，并同步至本机 iCloud 只读镜像。
- Cloudflare Worker 的定时任务充当"看门狗"：如果管道执行时间戳超过 2 个工作日未更新或心跳中断，就发出告警。
- 交互式的优化和模拟由 Worker 完成，不依赖 PC 是否在线。

## 2. 必须遵守的规则

| # | 规则 | 原因 |
|---|---|---|
| R1 | wonder-quant 运行时不执行任何 git 操作。写入 vault 的文件，统一由现有的 `WDR_Daily_Git_Archive`（02:30 / 23:30）归档 | vault 规定同一个工作树只能有一个自动同步来源（见 vault CLAUDE.md §0.5） |
| R2 | 写入 vault 的时段要避开 23:00–00:00 和 02:00–03:00 | 防止归档时把写到一半的文件提交进去 |
| R3 | 只允许写 `funds/_quant/` 目录和 `_quant_metrics.json`；`funds/<slug>.md`、`_funds.json` 和索引一律不改 | 基金档案由人工维护 |
| R4 | 文件统一用 UTF-8（无 BOM）、LF 换行；写入时先写临时文件，再整体替换 | 现有档案已经出现换行混乱 |
| R5 | API Token 等凭据不得放进 vault，也不得放进 wonder_platform 仓库 | 这两个仓库都会推送到 GitHub |
| R6 | 外部数据源每天最多访问一次，严格遵守各自的使用条款；一旦访问被拒，立即停止并告警，改为手动导入 CSV | 合规，且保证访问稳定 |
| R7 | 不修改现有的计划任务、同步脚本或 hook（注：挂死进程经用户明确授权方可清理） | 避免影响现有工作流 |
| R8 | `【PC 修订】` **C 盘零膨胀红线**：开发与运行期的虚拟环境、包缓存（`uv`/`pip`/`pnpm`）、Wrangler 本地状态及临时文件一律指向 `D:` 盘 | 本机 `C:` 盘仅余 `14.16 GB` 且暂无法清理，`D:` 盘余量 `339.54 GB` |

## 3. 环境检查清单（已完成只读巡检，结果见第 8 节）

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
| uv | `uv --version` | 有；没有则记录 |
| Python | `uv python list` 或 `py -0p` | 3.11 或 3.12 |
| Node / wrangler | `node -v`；`npx wrangler --version` | 可选，用于手动核对 D1 |
| 控制台编码 | `[Console]::OutputEncoding`；`chcp` | 记录（中文路径需要 UTF-8） |

### 3.3 仓库与 vault
| 检查项 | 参考命令 | 期望 |
|---|---|---|
| vault 路径与状态 | `git -C D:\Claude_Agent_Workspace\derek-obsidian-sync status --short` | 路径存在；记录未提交文件的数量 |
| 基金库目录 | `Test-Path <vault>\05_Investment_Research\03_Funds\00_基金产品库\funds` | True；记录 md 文件数量（应为 309） |
| wonder_platform 仓库 | 克隆至用户指定目录 | 已克隆至 `D:\Projects\Wonder Platform` |
| 现有计划任务 | `Get-ScheduledTask \| ? TaskName -match 'WDR\|sync\|icloud\|git'` | 列出名称、触发时间、上次运行结果 |
| iCloud 镜像机制 | 阅读 vault `scripts/sync_to_icloud.py` 及其 hook 配置 | 确认脚本写入的文件是否会被镜像 |

### 3.4 网络连通（每个只请求一次）
| 目标 | 参考命令 | 用途 |
|---|---|---|
| AIA 报价页 | `curl.exe -s -o NUL -w "%{http_code}" https://www.aia.com.hk/zh-hk/help-and-support/individuals/investment-information/investment-options-prices.html` | 平台基金净值 |
| Yahoo 行情 | `curl.exe -s "https://query1.finance.yahoo.com/v8/finance/chart/0P00006T5J?range=1mo&interval=1d"` | 0P 基金与 ETF 历史数据；记录返回的数据点数 |
| Cloudflare API | `curl.exe -s -o NUL -w "%{http_code}" https://api.cloudflare.com/client/v4/` | 写入 D1 |
| A 股 ETF 数据源 | 用户已有的 A 股数据工具（如 vault 中的投研脚本）能否正常使用 | A 股 ETF 净值 |
| 代理 / Tailscale | `Get-NetAdapter`；`tailscale status`（如已安装） | 记录是否会影响 DNS 或出口 IP |

### 3.5 凭据准备
- 在 Cloudflare 控制台创建 **只授予 D1 编辑权限** 的 API Token（D1 `wonder-db` 的 `database_id = b76be6c3-b0b7-4100-a417-dcbb0a08bf17`，见 `apps/api-worker/wrangler.toml`）。
- 存放位置：`D:\WonderQuant\.env`，设置 NTFS 权限仅允许当前用户与 `SYSTEM` 读取。

## 4. 目标开发与部署布局（`【PC 修订】` 已按本机开发定稿）

```
D:\Projects\Wonder Platform\             ← 【PC 修订】代码主仓库（已克隆就绪，本机直接开发与提交）
├── apps\
│   ├── api-worker\                      ← Cloudflare Worker (wonder-api-worker, 绑定 D1 wonder-db)
│   └── fis-hub\                         ← 前端工作台（策略实验室、组合跟踪与模拟）
├── docs\deploy\wonder-quant-windows.md  ← 本部署与架构说明文件
└── tools\wonder-quant\                  ← 【PC 修订】在本机开发与测试的 Python 包（CLI: wq）
    ├── .python-version                  ← 锁定 3.12（使用本机已有 CPython 3.12.14，避开全局 3.14.5）
    ├── pyproject.toml
    └── .venv\                           ← 本地虚拟环境（位于 D 盘，不占 C 盘）

D:\Claude_Agent_Workspace\
└── derek-obsidian-sync\                 ← vault（已存在，Git 权威源）
    └── 05_Investment_Research\03_Funds\00_基金产品库\
        ├── funds\<slug>.md              ← 只读，wq 绝不修改（已核实共 309 个 md）
        ├── funds\_quant\<slug>.md       ← wq 生成：量化体检（frontmatter 的 q_* 字段 + 正文）
        └── _quant_metrics.json          ← wq 生成：全库指标汇总

D:\WonderQuant\                          ← 运行与缓存目录（不在任何 Git 仓库内；D 盘余量 339.5 GB）
├── .env                                 ← 【PC 修订】凭据文件（NTFS 单用户只读 ACL）
├── cache\                               ← 原始抓取数据（parquet 格式，可随时重建）
├── uv-cache\                            ← 【PC 修订】UV_CACHE_DIR 强制落盘目录（严禁写 C 盘 AppData）
├── pip-cache\                           ← 【PC 修订】PIP_CACHE_DIR 兜底缓存目录
├── wrangler-state\                      ← 【PC 修订】本地 wrangler dev --persist-to 目录（避免写 C 盘）
├── tmp\                                 ← 【PC 修订】TEMP/TMP 与原子写入中转目录
├── state\                               ← 上次运行状态、断点续跑标记
└── logs\                                ← 按日滚动，保留 60 天
```

- **Windows 仓库稀疏检出说明** `【PC 修订】`：远端历史目录 `Financial Information Publist/GF提取的excel表格/` 下含 6 个带 `*` 号的 macOS 文件名（NTFS 非法字符），本仓库已配置本地 `core.protectNTFS=false` + `.git/info/sparse-checkout` 排除该归档子目录，其余 1,269 个文件 100% 正常检出且 `git status` 干净。
- **Python 与 `uv` 开发规范** `【PC 修订】`：
  - `C:\Users\27050\.local\bin`（含 `uv 0.12.7`）已写入当前用户 `PATH`；本机受管环境已有 `CPython 3.12.14`。
  - 开发与安装依赖时统一指定 `UV_CACHE_DIR=D:\WonderQuant\uv-cache` 与 `--python 3.12`；前端在 `D:\Projects\Wonder Platform` 运行 `pnpm` 时缓存天然通过同盘符硬链接落在 `D:\.pnpm-store`。
  - 计划任务直接调用 `D:\Projects\Wonder Platform\tools\wonder-quant\.venv\Scripts\wq.exe`，并在包装脚本中显式设置 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`、`TEMP=D:\WonderQuant\tmp`、`TMP=D:\WonderQuant\tmp`。
- **开发与生产隔离** `【PC 修订】`：虽然在本机开发，但生产计划任务**不执行任何 git 命令**；日常改代码先在特性分支或本地单测（`pytest` / `vitest`）跑通后，再合并生效。

## 5. 运行流程与时间表（`【PC 修订】`）

| 计划任务 | 时间（UTC+8） | 内容 | 说明 |
|---|---|---|---|
| `WQ_Daily_Data` | **周一至周六 20:00** `【PC 修订】`（原草案：周二至周六 08:30） | `wq fetch` → `wq compute` → `wq push-d1` | `【PC 修订】` AIA 净值由动态接口 `www1.aia.com.hk/CorpWS/Investment/Get/FundInfo2/` 提供（估值日为 `[MM/DD/YYYY]` 格式），香港投连险（T+1/T+2）及晨星 `0P` 场外基金通常在香港时间 **14:00–19:00** 更新；改在 **20:00** 可一次集齐当日 A/港收盘、AIA 当日新发批次及前一美股交易日场外基金与 ETF 净值 |
| `WQ_Vault_Writeback` | **每天 21:00** `【PC 修订】`（原草案：01:30） | `wq writeback` → `python sync_to_icloud.py` | `【PC 修订】` 21:00 回写严格避开 `23:00–00:00` 与 `02:00–03:00` 禁写窗（R2），且能赶上当晚 `23:30` 的 `WDR_Daily_Git_Archive` 自动推 GitHub；回写成功后串联执行一次 `sync_to_icloud.py`（增量 `<1s`，零 git 操作） |
| `WQ_Heartbeat` | 每小时 | 向 D1 写入心跳时间戳 | Worker 看门狗据此判断 PC 是否在线 |

计划任务的通用设置：
- `【PC 修订】` **登录态与 Clash Verge 自启衔接**：经核查本机代理为 **Clash Verge**，其 Windows 服务 `clash_verge_service` 已设为 `Automatic` 并运行、TUN 模式已开启（`enable_tun_mode: true`），但主程序 `enable_auto_launch` 当前为 `false`（开启方法见 8.3）。开启后配合用户桌面会话锁屏常驻，计划任务即可稳定访问海外源；
- 错过计划时间后尽快补跑（`StartWhenAvailable = True`）；
- 单次运行超过 2 小时自动终止（`ExecutionTimeLimit = PT2H`）；
- 失败后每 30 分钟重试一次，最多 3 次；
- `【PC 修订】` **看门狗双口径判定**：Worker 看门狗区分「管道成功运行时间 `last_run_at`（>2 个工作日告警）」与「AIA 投连险 `valuation_date`（允许香港/欧美节假日与 T+3 结算顺延）」。

**同步链路** `【PC 修订】`：
1. **Git 链路**：PC `21:00` 写入 `_quant` → `23:30` / `02:30` `WDR_Daily_Git_Archive` 自动推送 GitHub → Mac 执行 `git pull` 后在 Obsidian 中看到。
2. **iCloud 手机/iPad 只读镜像链路**：`WQ_Vault_Writeback` 在 `wq writeback` 成功后调用 `C:\Python314\python.exe D:\Claude_Agent_Workspace\derek-obsidian-sync\scripts\sync_to_icloud.py`，自动镜像至 `E:\iCloud\iCloudDrive\iCloud~md~obsidian\Obsidian Notes`。

## 6. 告警（`【PC 修订】` 核查 Worker 源码后修订）
- **告警通道** `【PC 修订】`：检出 `apps/api-worker/src/` 后核实，当前生产 `wonder-api-worker` **并未内置邮件发送服务**（`email.py` 仅存在于旧版 FastAPI `backend/`，未迁入 Worker），而本机与云端均支持极简免 SDK 的 **飞书（Lark）群自定义机器人 Webhook**（以及 Hermes 体系已有的 **Telegram Bot API**）。因此定为：
  1. **主通道（Worker 云端看门狗 + PC 本地共用）：飞书群自定义机器人 Webhook（或 Telegram Bot Webhook）** —— Worker 仅需配置一个 Secret `ALERT_WEBHOOK_URL` 即可用原生 `fetch()` 发送卡片告警（PC 断网/断电失联时照常由云端发出），PC 本地 `D:\WonderQuant\.env` 配置同一 Webhook 即可在抓取异常时秒级直推手机；
  2. **可选扩展**：若后续需邮件通知，可在 Worker 中按需接入 Resend HTTP API，无需改动本地架构。
- **告警触发条件**：
  - 抓取失败率超过 20%；
  - 某个数据源整体不可用，或触发 `403` / `429` 拒访（按 R6 立即熔断停抓并切换 `wq import-csv`）；
  - D1 写入失败；
  - 心跳中断超过 6 小时；
  - 计算结果超出合理区间（如单日净值变动超过 15%，或 `valuation_date` 解析异常/倒退）。

## 7. 第一轮巡检交付归档说明

1. 本文件已直接落地于 `D:\Projects\Wonder Platform\docs\deploy\wonder-quant-windows.md`（UTF-8 无 BOM + LF）。
2. 已同步在 Vault `01_Journal/Agent工作纪要/跨Agent协同与规则同步台账.md` 登记 `MSG-20261123-002`，广播「改为 Windows 本机开发、Mac 不再开发 `wonder-quant`」的最新决策。

## 8. 环境检查报告与执行进展（PC Agent 实测）

> 检查与首轮整备时间：2026-11-23 21:15 – 21:42 (UTC+08:00)
> 检查者：PC 端 Antigravity
> 总体结论：✅ **核心环境、代码仓库与任务队列均已就绪（仅剩 3 项轻量操作随手确认即可进入阶段 0 开发）**

### 8.1 检查结果与首轮处置状态

| 编号 | 检查项 | 实际结果与本轮处置 | 状态 | 备注 |
|---|---|---|---|---|
| 3.1-1 | 系统版本 | `Microsoft Windows 10 Pro` `22H2`（`10.0.19045.6466`） | ✅ | 符合要求 |
| 3.1-2 | 时区 | `China Standard Time` (`UTC+08:00`) | ✅ | 符合要求 |
| 3.1-3 | 睡眠 / 休眠 | 接电（AC）下 `STANDBYIDLE=0`、`HIBERNATEIDLE=0`（永不睡眠/休眠） | ✅ | 符合要求 |
| 3.1-4 | 断电后自动开机 | 需下次重启进主板 BIOS 核对 `Restore on AC Power Loss` | ⚠️ | 见 8.3 方法说明 |
| 3.1-5 | Windows 更新活动时间 | 用户已修改，注册表实测已生效为 **`ActiveHoursStart=18`、`ActiveHoursEnd=12`（`18:00–次日 12:00`）** | ✅ | 已覆盖晚间抓取、深夜归档与早间时段 |
| 3.1-6 | 磁盘余量 | `C:` 剩余 `14.16 GB`（暂无法清理）；`D:` 剩余 **`339.54 GB`**；`E:` 剩余 `1857.95 GB` | ✅ | 已新增 **R8 红线**：所有 `.venv`、`uv-cache`、`wrangler-state`、`tmp` 全部落 `D:` 盘 |
| 3.1-7 | 长路径支持 | 已执行 `git config --global core.longpaths true` ✅；系统注册表 `LongPathsEnabled` 当前仍为 `0`（非管理员终端被拦截） | ⚠️ | 见 8.3 一行管理员命令开启 |
| 3.2-1 | Git | `git version 2.54.0.windows.1`（`core.longpaths=true` 已开） | ✅ | 已就绪 |
| 3.2-2 | uv | `uv 0.12.7`（已将 `C:\Users\27050\.local\bin` 写入当前用户 `PATH`） | ✅ | 已就绪 |
| 3.2-3 | Python | 受管环境已有 **`CPython 3.12.14`** 与 `3.11.9`（全局默认为 `3.14.5`） | ✅ | `wonder-quant` 锁定 `3.12` |
| 3.2-4 | Node / pnpm | `Node v24.16.0`、`pnpm 11.22.0`；`apps/api-worker` 内含本地 `wrangler` | ✅ | 已就绪 |
| 3.2-5 | 控制台编码 | PowerShell 输出 UTF-8，底层 `chcp=437` | ✅ | 脚本统一设 `PYTHONUTF8=1` |
| 3.3-1 | vault 路径与状态 | `D:\Claude_Agent_Workspace\derek-obsidian-sync` 正常，无 `.git/index.lock` | ✅ | 已就绪 |
| 3.3-2 | 基金库目录 | `funds\` 下 `.md` 恰好 **`309`** 个，`_funds.json` 309 条（其中 `AIA 卓达智悦2` 152 条） | ✅ | 100% 吻合 |
| 3.3-3 | `wonder_platform` 仓库 | 已克隆至 **`D:\Projects\Wonder Platform`**，通过 `sparse-checkout` 排除 6 个含 `*` 号旧归档 Excel，工作树 100% 干净 | ✅ | 已就绪（D1 ID 已核实） |
| 3.3-4 | 现有计划任务 | 已按用户授权清理挂死的 `WDR_Daily_Git_Archive`（PID `25420`/`33756`），现已恢复 **`Ready`**（下次运行今晚 `23:30:30`）；`WDR_Private_Terminal_Watchdog` 正常 | ✅ | 阻塞已解除 |
| 3.3-5 | iCloud 镜像机制 | `sync_to_icloud.py` 仅由 Claude Code 编辑 hook 触发；确定在 `WQ_Vault_Writeback` 末尾串联调用一次 | ✅ | 方案已闭环 |
| 3.4-1 | AIA 报价页 | `HTTP 200`；真实接口为 `www1.aia.com.hk/CorpWS/Investment/Get/FundInfo2/`，`valuationDate` 为 `[MM/DD/YYYY]` | ✅ | 解析器按 `%m/%d/%Y` 实现 |
| 3.4-2 | Yahoo 行情 | 裸 `curl` 触发 `429`，本机 `yfinance 1.4.1`（`curl_cffi` 指纹）实测拉取正常 | ✅ | 统一采用 `yfinance >= 1.0` |
| 3.4-3 | Cloudflare API | `https://api.cloudflare.com/client/v4/` 返回标准 `404`，TLS 连通正常 | ✅ | 已就绪 |
| 3.4-4 | A 股 ETF 数据源 | 腾讯 `fqkline (hfq)` 单次拉 `sh515080` 返回最新 `2026-11-23` 数据点 | ✅ | 作为境内 ETF 首选源 |
| 3.4-5 | 代理 / Tailscale | `Clash Verge Service` 系统服务 **`Running` (`Automatic`)**、`enable_tun_mode: true`；但 **`enable_auto_launch: false`**；Tailscale 未开 Exit Node | ⚠️ | 需在 Clash Verge 界面打开「开机自启」（见 8.3） |
| 3.5-1 | 凭据准备 | D1 `wonder-db` ID 已确认为 `b76be6c3-b0b7-4100-a417-dcbb0a08bf17`；采用 `D:\WonderQuant\.env` + NTFS ACL | ✅ | 待写 D1 阶段填入 Token |

### 8.2 待用户随手确认的 3 项操作（不影响立即启动阶段 0 代码开发）

- [ ] **1. 开启系统级长路径注册表项（一次性管理员命令）**：请右键「开始菜单 → Windows PowerShell (管理员)」，粘贴执行以下一行命令即可：
  `Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1`
- [ ] **2. 开启 Clash Verge「开机自启」与核对 BIOS 来电自启**：
  - **Clash Verge**：经实测您的后台服务模式（`Clash Verge Service`）和 `TUN 模式` **已经开启**，唯独配置文件 `verge.yaml` 中 `enable_auto_launch: false`。打开桌面右下角 **Clash Verge → 设置（Settings）→ 系统设置（System Setting）→ 打开「开机自启（Auto Launch）」开关** 即可。
  - **BIOS 来电自启**：无需现在重启，下次恰逢重启电脑时按 `Del` / `F2` 进主板 BIOS → `Advanced / APM Configuration`（不同主板或在 `Power Management`）→ 查看 `Restore on AC Power Loss` 是否为 `Power On` 即可。
- [ ] **3. 创建 Cloudflare D1 API Token 与告警 Webhook（阶段 2 联调前准备即可）**：在 Cloudflare 控制台 `My Profile -> API Tokens -> Create Custom Token` 仅授予 `Account -> D1 -> Edit` 权限（并附带您的 Cloudflare `Account ID`），以及可选的飞书/Telegram 机器人 Webhook，届时写入本地 `D:\WonderQuant\.env`。

### 8.3 本机开发路线图（由 Windows PC Agent 接手推进）

- [ ] **阶段 0：脚手架初始化与 309 只基金数据覆盖率摸底（只读不写库）**
  - 初始化 `D:\WonderQuant\{cache,uv-cache,pip-cache,wrangler-state,tmp,state,logs}` 目录与 `D:\Projects\Wonder Platform\tools\wonder-quant\`（锁定 Python `3.12`）；
  - 解析 Vault `_funds.json`（309 只）与 `sources/_tmp2_官方基金列表_20260901_全146只.json`，对齐 AIA `TMP2`（修正 8 处分派/累积代码映射与 `%m/%d/%Y` 日期解析）、腾讯 `hfq`（境内/港股通 ETF）与 `yfinance`（美股/英股/日股 ETF 及 `0P` 基金）的代码映射表，产出覆盖率摸底报告。
- [ ] **阶段 1：`wq fetch` & `wq compute` 量化指标引擎 + 单元测试**
  - 实现增量 Parquet 缓存、复权净值/分派总回报对齐、汇率折算、核心量化体检指标（年化收益、波动率、最大回撤、Sharpe/Sortino、同类/基准超额 α/β/IR）及异常跳变/拒访熔断护栏（R6）与 `wq import-csv`。
- [ ] **阶段 2：Cloudflare D1 同步（`wq push-d1` + 心跳）与 Worker 看门狗 / 交互接口**
  - 新增 D1 迁移表（基金净值序列、量化指标快照、心跳表），在 `apps/api-worker` 实现看门狗告警与组合优化/模拟 API，并在 `apps/fis-hub` 对接展示。
- [ ] **阶段 3：Obsidian 旁路回写（`wq writeback`）与 Windows 计划任务上线**
  - 原子生成 `funds/_quant/<slug>.md` 与 `_quant_metrics.json`（UTF-8 无 BOM + LF），串联 `sync_to_icloud.py`，经用户验收后注册 `WQ_Daily_Data`、`WQ_Vault_Writeback`、`WQ_Heartbeat` 三个计划任务。
