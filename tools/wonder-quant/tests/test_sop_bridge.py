from pathlib import Path

import pytest

from wonder_quant.config import load_settings
from wonder_quant.sop_bridge import (
    check_commercial_tabs_compliance,
    extract_fund_tabs,
    publish_sop_to_d1,
)


def test_extract_and_compliance(tmp_path: Path) -> None:
    sample = """---
slug: "CN_512890"
code: "512890"
fund_name: "测试红利ETF"
fund_type: "ETF"
val_route: "FV1"
sop_version: "2.0"
edition: "commercial"
report_date: "2026-11-26"
data_as_of: "2026-11-25"
medal_rating: "Bronze"
pillar_score: 0.75
g1_g5_pass: true
uncertainty: "Medium"
valuation_zone: "合理偏低"
valuation_pct_5y: 35.0
dividend_yield_ttm: 4.5
dividend_spread_rf: 2.3
one_liner: "客观定位"
red_flag_top: "行业集中"
---
<!-- FUND_TAB: executive_memo | ⚡ 商业与策略速览 -->
客观摘要。
<!-- FUND_TAB: deep_dive | 🏰 机制、团队与治理 -->
机制与费率。
<!-- FUND_TAB: valuation_dividend | 📈 历史估值与分红比较 -->
估值分位 35%。
<!-- FUND_TAB: masters | 🏛️ 六大价值大师审问 -->
| 价值投资大师 | 核心审问聚焦 | 量化证据摘要 | 立场 | 触发红旗？ |
|---|---|---|---|---|
| **John Bogle** | 成本 | 低费率 | 支持 | 否 |
<!-- FUND_TAB: risks_onepager | 🛡️ 风险、情景与一页纸 -->
红队风险与一页纸。
"""
    rdir = tmp_path / "512890"
    rdir.mkdir()
    (rdir / ".review").mkdir()
    (rdir / ".review" / "xray_profile.json").write_text(
        '{"source":"sop_v2","asset_split":{"equity":99,"bond":0,"cash":1,"other":0},"sectors":{"financials":70}}',
        encoding="utf-8",
    )
    (rdir / "512890-基金商业分析-20261126.md").write_text(sample, encoding="utf-8")
    (rdir / "512890-基金估值与投资决策-20261126.md").write_text("# B稿\nPlan A", encoding="utf-8")
    (rdir / "512890-基金一页纸-20261126.md").write_text("# 一页纸", encoding="utf-8")

    tabs = extract_fund_tabs(sample)
    assert len(tabs) == 5
    assert check_commercial_tabs_compliance(tabs) == []

    res = publish_sop_to_d1(load_settings(), slug="CN_512890", report_dir=rdir, dry_run=True)
    assert res["dry_run"] is True
    assert res["masters_parsed"] == 1
    assert res["xray_profile_ready"] is True
    assert len(res["tabs"]) == 5


def test_compliance_blocks_advice(tmp_path: Path) -> None:
    bad = """---
slug: "CN_512890"
edition: "commercial"
---
<!-- FUND_TAB: executive_memo | ⚡ 商业与策略速览 -->
建议买入 10% 仓位。
<!-- FUND_TAB: deep_dive | 🏰 机制 -->
ok
<!-- FUND_TAB: valuation_dividend | 📈 估值 -->
ok
<!-- FUND_TAB: masters | 🏛️ 大师 -->
ok
<!-- FUND_TAB: risks_onepager | 🛡️ 风险 -->
ok
"""
    rdir = tmp_path / "bad"
    rdir.mkdir()
    (rdir / "512890-基金商业分析-20261126.md").write_text(bad, encoding="utf-8")
    with pytest.raises(ValueError, match="compliance violation"):
        publish_sop_to_d1(load_settings(), slug="CN_512890", report_dir=rdir, dry_run=True)
