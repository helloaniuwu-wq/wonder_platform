from __future__ import annotations

import os
import socket
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

HKT = ZoneInfo("Asia/Shanghai")

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = PACKAGE_ROOT / "config"

# R2 blackout windows (UTC+8): avoid 23:00-00:00 and 02:00-03:00 around WDR_Daily_Git_Archive
VAULT_WRITE_BLACKOUT_WINDOWS: tuple[tuple[time, time], ...] = (
    (time(23, 0), time(23, 59, 59)),
    (time(2, 0), time(2, 59, 59)),
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", env_prefix="WQ_")

    home_dir: Path = Field(default=Path(r"D:\WonderQuant"))
    vault_fund_dir: Path = Field(
        default=Path(
            r"D:\Claude_Agent_Workspace\derek-obsidian-sync\05_Investment_Research\03_Funds\00_基金产品库"
        )
    )
    risk_free_rate: float = Field(default=0.04)
    anomaly_daily_move_threshold: float = Field(default=0.15)
    failure_rate_alert_threshold: float = Field(default=0.20)
    history_years: int = Field(default=15)
    incremental_days: int = Field(default=40)
    host_id: str = Field(default_factory=lambda: socket.gethostname().lower())

    # Credentials loaded from D:\WonderQuant\.env (unprefixed standard names)
    cf_account_id: str = Field(default="")
    cf_d1_database_id: str = Field(default="b76be6c3-b0b7-4100-a417-dcbb0a08bf17")
    cf_api_token: str = Field(default="")
    alert_webhook_url: str = Field(default="")
    lark_webhook_url: str = Field(default="")
    https_proxy: str = Field(default="")

    @property
    def cache_dir(self) -> Path:
        return self.home_dir / "cache"

    @property
    def state_dir(self) -> Path:
        return self.home_dir / "state"

    @property
    def log_dir(self) -> Path:
        return self.home_dir / "logs"

    @property
    def tmp_dir(self) -> Path:
        return self.home_dir / "tmp"

    @property
    def imports_dir(self) -> Path:
        return self.home_dir / "imports"

    @property
    def env_file(self) -> Path:
        return self.home_dir / ".env"

    @property
    def effective_webhook_url(self) -> str:
        return (self.alert_webhook_url or self.lark_webhook_url or "").strip()

    def ensure_runtime_dirs(self) -> None:
        for d in (self.home_dir, self.cache_dir, self.state_dir, self.log_dir, self.tmp_dir, self.imports_dir):
            d.mkdir(parents=True, exist_ok=True)


def _discover_wrangler_oauth_token() -> str:
    """Fallback to local Wrangler CLI OAuth token if CF_API_TOKEN is not in .env."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return ""
    candidates: list[Path] = []
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "xdg.config" / ".wrangler" / "config" / "default.toml")
    home = Path.home()
    candidates.extend([
        home / ".wrangler" / "config" / "default.toml",
        home / ".config" / ".wrangler" / "config" / "default.toml",
        home / "Library" / "Preferences" / ".wrangler" / "config" / "default.toml",
    ])
    for cfg in candidates:
        if cfg.exists():
            try:
                import tomllib
                data = tomllib.loads(cfg.read_text(encoding="utf-8"))
                tok = str(data.get("oauth_token") or "").strip()
                if tok:
                    return tok
            except Exception:
                continue
    return ""


def load_settings(home_dir: Path | None = None) -> Settings:
    resolved_home = home_dir or Path(os.environ.get("WQ_HOME_DIR", r"D:\WonderQuant"))
    env_path = resolved_home / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)

    api_token = os.environ.get("CF_API_TOKEN", "").strip() or _discover_wrangler_oauth_token()
    default_acct = "a03e9f93843398c2ba140ffcb2c2bcfb" if api_token else ""
    account_id = os.environ.get("CF_ACCOUNT_ID", "").strip() or default_acct

    return Settings(
        home_dir=resolved_home,
        cf_account_id=account_id,
        cf_d1_database_id=os.environ.get("CF_D1_DATABASE_ID", "b76be6c3-b0b7-4100-a417-dcbb0a08bf17"),
        cf_api_token=api_token,
        alert_webhook_url=os.environ.get("ALERT_WEBHOOK_URL", ""),
        lark_webhook_url=os.environ.get("LARK_WEBHOOK_URL", ""),
        https_proxy=os.environ.get("HTTPS_PROXY", ""),
    )


def now_hkt() -> datetime:
    return datetime.now(tz=HKT)


def is_in_vault_blackout(dt: datetime | None = None) -> bool:
    """Return True if dt (UTC+8) falls within R2 vault blackout windows (23:00-00:00 or 02:00-03:00)."""
    current = (dt or now_hkt()).astimezone(HKT).time()
    return any(start <= current <= end for start, end in VAULT_WRITE_BLACKOUT_WINDOWS)
