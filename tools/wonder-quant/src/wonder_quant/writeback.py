from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from wonder_quant.config import is_in_vault_blackout, now_hkt
from wonder_quant.models import FundMetrics, FundRecord
from wonder_quant.storage import atomic_write_json, atomic_write_text


def _fmt_pct(val: float | None) -> str:
    return f"{val * 100:+.2f}%" if val is not None else "—"


def _fmt_num(val: float | None, digits: int = 2) -> str:
    return f"{val:.{digits}f}" if val is not None else "—"


def _assert_allowed_vault_path(vault_fund_dir: Path, target: Path) -> None:
    """Hard R3 guardrail: ONLY funds/_quant/<slug>.md and _quant_metrics.json may ever be written."""
    resolved_root = vault_fund_dir.resolve()
    resolved_target = target.resolve()
    allowed_quant_dir = (resolved_root / "funds" / "_quant").resolve()
    allowed_metrics_file = (resolved_root / "_quant_metrics.json").resolve()
    if resolved_target == allowed_metrics_file:
        return
    if resolved_target.parent == allowed_quant_dir and resolved_target.suffix == ".md":
        return
    raise PermissionError(f"[R3 VIOLATION] Refusing to write outside _quant allowlist: {resolved_target}")


def render_quant_markdown(fund: FundRecord, m: FundMetrics) -> str:
    fm: dict[str, Any] = {
        "source_fund": f"[[{fund.slug}]]",
        "q_slug": fund.slug,
        "q_code": fund.code,
        "q_aia_code": fund.aia_code,
        "q_as_of_date": m.as_of_date,
        "q_valuation_date": m.valuation_date,
        "q_data_tier": m.data_tier,
        "q_nav": m.latest_nav,
        "q_currency": m.latest_nav_currency,
        "q_ret_1m": m.ret_1m,
        "q_ret_3m": m.ret_3m,
        "q_ret_6m": m.ret_6m,
        "q_ret_ytd": m.ret_ytd,
        "q_ret_1y": m.ret_1y,
        "q_ret_3y_ann": m.ret_3y_ann,
        "q_ret_5y_ann": m.ret_5y_ann,
        "q_vol_1y": m.vol_1y,
        "q_vol_3y": m.vol_3y,
        "q_max_dd_1y": m.max_dd_1y,
        "q_max_dd_3y": m.max_dd_3y,
        "q_max_dd_5y": m.max_dd_5y,
        "q_dd_recovery_days": m.dd_recovery_days,
        "q_sharpe_3y": m.sharpe_3y,
        "q_sortino_3y": m.sortino_3y,
        "q_calmar_3y": m.calmar_3y,
        "q_beta_3y": m.beta_3y,
        "q_alpha_3y": m.alpha_3y,
        "q_r2_3y": m.r2_3y,
        "q_ir_3y": m.ir_3y,
        "q_div_yield_ttm": m.div_yield_ttm,
        "q_peer_rank_pct": m.peer_rank_pct,
        "q_quant_score": m.quant_score,
        "q_quant_grade": m.quant_grade,
        "q_obs_days": m.obs_days,
        "q_generated_at": m.computed_at,
    }
    fm_yaml = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False).strip()

    tier_desc = {
        "A": "Tier A（市场官方总回报日线）",
        "B": "Tier B（底层代理历史回溯 + 官方日度追加）",
        "C": "Tier C（历史样本不足 1 年 / 单点快照）",
        "U": "Tier U（暂缺有效净值源）",
    }.get(m.data_tier, m.data_tier)

    peer_str = f"前 {(1.0 - m.peer_rank_pct) * 100:.1f}%" if m.peer_rank_pct is not None else "—"
    anomalies_block = (
        "\n> [!warning] 数据异常提示\n> " + "; ".join(m.anomalies) + "\n" if m.anomalies else ""
    )

    body = f"""---
{fm_yaml}
---
# {fund.code} · {fund.name}（量化体检）

> 关联主档案：[[{fund.slug}]] ｜ 数据层级：{tier_desc} ｜ 最新估值日：`{m.valuation_date or '—'}` ｜ 参照基准：`{fund.benchmark_code}`
{anomalies_block}
## 核心量化快照

| 维度 | 指标 | 数值 |
|---|---|---|
| 最新净值 | 单位净值 ({m.latest_nav_currency}) | `{_fmt_num(m.latest_nav, 4)}` |
| 综合评定 | 量化等级 / 综合分 / 同类分位 | **{m.quant_grade or '—'}** / `{_fmt_num(m.quant_score, 1)}` / {peer_str} |
| 收益表现 | YTD / 1Y / 3Y年化 / 5Y年化 | {_fmt_pct(m.ret_ytd)} / {_fmt_pct(m.ret_1y)} / {_fmt_pct(m.ret_3y_ann)} / {_fmt_pct(m.ret_5y_ann)} |
| 风险回撤 | 3Y波动 / 3Y最大回撤 / 5Y最大回撤 | {_fmt_pct(m.vol_3y)} / {_fmt_pct(m.max_dd_3y)} / {_fmt_pct(m.max_dd_5y)} |
| 风险调整 | Sharpe / Sortino / Calmar | `{_fmt_num(m.sharpe_3y)}` / `{_fmt_num(m.sortino_3y)}` / `{_fmt_num(m.calmar_3y)}` |
| 基准归因 | Alpha / Beta / R² / IR | {_fmt_pct(m.alpha_3y)} / `{_fmt_num(m.beta_3y)}` / `{_fmt_num(m.r2_3y)}` / `{_fmt_num(m.ir_3y)}` |
| 现金流 | TTM 派息收益率 / 观测交易日数 | {_fmt_pct(m.div_yield_ttm)} / `{m.obs_days}` 日 |

---
*本文件由 `wonder-quant` 自动原子生成（UTF-8 无 BOM / LF），请勿手工编辑；人工研究笔记请维护于主档案 [[{fund.slug}]]。*
"""
    return body


def writeback_to_vault(
    vault_fund_dir: Path,
    funds: list[FundRecord],
    metrics: list[FundMetrics],
    current_time: datetime | None = None,
    allow_blackout_override: bool = False,
) -> dict[str, int]:
    """
    Atomically write sidecar quant markdown files into funds/_quant/<slug>.md
    and summary _quant_metrics.json (R1, R2, R3, R4).
    """
    if not allow_blackout_override and is_in_vault_blackout(current_time):
        raise RuntimeError(
            "[R2 BLACKOUT] Refusing to write to Obsidian Vault during 23:00-00:00 or 02:00-03:00 UTC+8."
        )

    fund_map = {f.slug: f for f in funds if f.is_trackable}
    quant_dir = vault_fund_dir / "funds" / "_quant"
    quant_dir.mkdir(parents=True, exist_ok=True)

    written_md = 0
    summary_items: list[dict[str, Any]] = []

    for m in sorted(metrics, key=lambda x: x.slug):
        f = fund_map.get(m.slug)
        if not f:
            continue
        if f.is_vault_native:
            md_target = quant_dir / f"{f.slug}.md"
            _assert_allowed_vault_path(vault_fund_dir, md_target)
            atomic_write_text(md_target, render_quant_markdown(f, m))
            written_md += 1
        summary_items.append(
            {
                "slug": f.slug,
                "code": f.code,
                "aia_code": f.aia_code,
                "name": f.name,
                "asset_class": f.asset_class,
                "ilas_platform": f.ilas_platform,
                "currency": f.currency,
                "benchmark_code": f.benchmark_code,
                **m.model_dump(),
            }
        )

    summary_target = vault_fund_dir / "_quant_metrics.json"
    _assert_allowed_vault_path(vault_fund_dir, summary_target)
    summary_payload = {
        "schema_version": "1.0",
        "generated_at": now_hkt().isoformat(timespec="seconds"),
        "count": len(summary_items),
        "items": summary_items,
    }
    atomic_write_json(summary_target, summary_payload, indent=2)
    return {"written_md": written_md, "summary_count": len(summary_items)}
