from __future__ import annotations

import json
import sys
from pathlib import Path

import typer

from wonder_quant import __version__
from wonder_quant.catalog import load_catalog, summarize_catalog
from wonder_quant.config import is_in_vault_blackout, load_settings
from wonder_quant.d1_client import D1Client
from wonder_quant.pipeline import (
    run_compute,
    run_fetch,
    run_import_csv,
    run_macro,
    run_push_d1,
    run_writeback,
)
from wonder_quant.sop_bridge import publish_sop_to_d1, pull_research_queue_to_vault
from wonder_quant.storage import FetchLedger

app = typer.Typer(name="wq", help="Wonder Quant — Windows PC fund ingestion, quant analytics & D1 sync CLI.")


@app.command()
def doctor() -> None:
    """Check paths, Vault accessibility, D1 credentials presence, and R2/R8 guardrails."""
    settings = load_settings()
    settings.ensure_runtime_dirs()
    info = {
        "version": __version__,
        "python": sys.version.split()[0],
        "host_id": settings.host_id,
        "home_dir": str(settings.home_dir),
        "vault_fund_dir_exists": settings.vault_fund_dir.exists(),
        "env_file_exists": settings.env_file.exists(),
        "cf_credentials_configured": bool(settings.cf_account_id and settings.cf_api_token),
        "cf_d1_database_id": settings.cf_d1_database_id,
        "webhook_configured": bool(settings.effective_webhook_url),
        "in_vault_blackout_now": is_in_vault_blackout(),
    }
    typer.echo(json.dumps(info, ensure_ascii=False, indent=2))


@app.command()
def catalog(
    report: bool = typer.Option(True, "--report/--no-report", help="Print coverage summary report"),
    export_json: Path | None = typer.Option(None, "--export-json", help="Export full catalog JSON"),
) -> None:
    """Audit and summarize the 309-fund Obsidian catalog without modifying Vault files."""
    settings = load_settings()
    records = load_catalog(settings.vault_fund_dir)
    if report:
        typer.echo(json.dumps(summarize_catalog(records), ensure_ascii=False, indent=2))
    if export_json:
        from wonder_quant.storage import atomic_write_json

        atomic_write_json(export_json, [r.model_dump() for r in records])
        typer.echo(f"Exported {len(records)} catalog entries to {export_json}")


@app.command()
def fetch(
    force: bool = typer.Option(False, "--force", help="Bypass R6 same-day fetch ledger check"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Plan only, make 0 external requests"),
    limit_yahoo: int | None = typer.Option(None, "--limit-yahoo", help="Limit Yahoo tickers for quick testing"),
    full_backfill: bool = typer.Option(False, "--full-backfill", help="Re-fetch full 15Y history instead of 40d incremental"),
) -> None:
    """Fetch fund NAVs, dividends, FX rates, and benchmarks into local Parquet cache."""
    settings = load_settings()
    summary = run_fetch(settings, force=force, dry_run=dry_run, limit_yahoo=limit_yahoo, full_backfill=full_backfill)
    typer.echo(json.dumps(summary.model_dump(), ensure_ascii=False, indent=2))
    if summary.status in ("failed", "circuit_open"):
        raise typer.Exit(code=2)


@app.command()
def compute() -> None:
    """Compute quantitative metrics and peer grades from local Parquet cache."""
    settings = load_settings()
    metrics = run_compute(settings)
    tiers: dict[str, int] = {}
    for m in metrics:
        tiers[m.data_tier] = tiers.get(m.data_tier, 0) + 1
    typer.echo(json.dumps({"computed": len(metrics), "tiers": tiers}, ensure_ascii=False, indent=2))


@app.command("push-d1")
def push_d1(full: bool = typer.Option(False, "--full", help="Ignore SHA256 dirty cache and push all rows")) -> None:
    """Push packed time-series and metrics to Cloudflare D1 via REST API."""
    settings = load_settings()
    stats = run_push_d1(settings, full=full)
    typer.echo(json.dumps(stats, ensure_ascii=False, indent=2))


@app.command()
def writeback(
    override_blackout: bool = typer.Option(False, "--override-blackout", help="Override R2 blackout check"),
) -> None:
    """Write sidecar _quant markdown cards and _quant_metrics.json into Obsidian Vault (UTF-8/LF)."""
    settings = load_settings()
    res = run_writeback(settings, allow_blackout_override=override_blackout)
    typer.echo(json.dumps(res, ensure_ascii=False, indent=2))


@app.command()
def heartbeat() -> None:
    """Send PC liveness heartbeat to Cloudflare D1 wq_heartbeat table."""
    settings = load_settings()
    D1Client(settings).send_heartbeat(wq_version=__version__)
    typer.echo(json.dumps({"status": "ok", "host_id": settings.host_id, "version": __version__}))


@app.command("import-csv")
def import_csv(
    csv_file: Path = typer.Argument(..., exists=True, readable=True),
    slug: str = typer.Option(..., "--slug", help="Target fund slug, e.g. B01_F"),
) -> None:
    """Import manual CSV fallback series (R6) into local Parquet cache."""
    settings = load_settings()
    n = run_import_csv(settings, csv_file, slug)
    typer.echo(json.dumps({"imported_rows": n, "slug": slug, "file": str(csv_file)}))


@app.command("run-daily")
def run_daily(
    force: bool = typer.Option(False, "--force"),
    skip_d1: bool = typer.Option(False, "--skip-d1", help="Skip D1 push (useful before CF Token setup)"),
    full_backfill: bool = typer.Option(False, "--full-backfill", help="Re-fetch full 15Y history instead of 40d incremental"),
) -> None:
    """Execute full daily batch: fetch -> compute -> push-d1."""
    settings = load_settings()
    summary = run_fetch(settings, force=force, full_backfill=full_backfill)
    metrics = run_compute(settings)
    d1_stats = None
    if not skip_d1 and settings.cf_account_id and settings.cf_api_token:
        d1_stats = run_push_d1(settings, full=False)
    typer.echo(
        json.dumps(
            {
                "fetch_status": summary.status,
                "succeeded_funds": summary.succeeded_funds,
                "total_funds": summary.total_funds,
                "computed": len(metrics),
                "d1": d1_stats,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command()
def macro(
    push: bool = typer.Option(False, "--push", help="Push computed macro & commodity snapshot to Cloudflare D1"),
    full: bool = typer.Option(False, "--full", help="Bypass SHA256 cache when pushing to D1"),
) -> None:
    """Fetch macro rates, valuation percentiles, gold, oil & commodity regime snapshot."""
    settings = load_settings()
    snapshot = run_macro(settings)
    pushed_rows = 0
    if push and settings.cf_account_id and settings.cf_api_token:
        ledger = FetchLedger(settings.state_dir)
        pushed_rows = D1Client(settings).push_macro_snapshot(snapshot, ledger=ledger, full=full)
    typer.echo(json.dumps({"snapshot": snapshot.model_dump(), "d1_rows_written": pushed_rows}, ensure_ascii=False, indent=2))


@app.command("pull-research-queue")
def pull_research_queue(
    out_file: Path | None = typer.Option(None, "--out", help="Output markdown path (default: 02_Ideas/基金分析线索.md)"),
) -> None:
    """Pull FIS Hub fund research watchlist queue from D1 into Obsidian."""
    settings = load_settings()
    res = pull_research_queue_to_vault(settings, out_file=out_file)
    typer.echo(json.dumps(res, ensure_ascii=False, indent=2))


@app.command("publish-sop")
def publish_sop(
    slug: str = typer.Argument(..., help="Fund slug in D1/catalog, e.g. CN_512890 or Z29_F"),
    report_dir: Path | None = typer.Option(None, "--report-dir", help="Folder holding SOP v2.0 markdown deliverables"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate and parse without writing to D1"),
    invalidate_url: str | None = typer.Option(None, "--invalidate-url", help="Optional cache invalidation endpoint"),
    via_wrangler: bool = typer.Option(False, "--via-wrangler", help="Force Wrangler OAuth CLI transport for remote D1"),
) -> None:
    """Publish validated SOP v2.0 fund deliverables to Cloudflare D1 wq_fund_sop_reports."""
    settings = load_settings()
    vault_root = settings.vault_fund_dir.parents[2]
    code_guess = slug.split("_")[-1] if "_" in slug and not slug.endswith("_F") else slug.removesuffix("_F")
    rdir = report_dir or (vault_root / "05_Investment_Research" / "03_Funds" / code_guess)
    res = publish_sop_to_d1(
        settings,
        slug=slug,
        report_dir=rdir,
        dry_run=dry_run,
        invalidate_url=invalidate_url,
        via_wrangler=via_wrangler,
    )
    typer.echo(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    app()
