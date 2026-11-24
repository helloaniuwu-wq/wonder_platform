from __future__ import annotations

from typing import Any

import httpx

from wonder_quant.config import Settings, now_hkt


def send_local_alert(settings: Settings, title: str, lines: list[str], level: str = "WARN") -> bool:
    """Send immediate alert via configured Feishu/Lark or generic JSON Webhook."""
    url = settings.effective_webhook_url
    if not url:
        return False

    ts = now_hkt().strftime("%Y-%m-%d %H:%M:%S +08:00")
    body_text = f"[{level}] {title}\n主机: {settings.host_id}\n时间: {ts}\n" + "\n".join(f"- {ln}" for ln in lines)
    payload: dict[str, Any] = {
        "msg_type": "text",
        "content": {"text": body_text},
    }
    kwargs: dict[str, Any] = {"timeout": 12.0}
    if settings.https_proxy:
        kwargs["proxy"] = settings.https_proxy
    try:
        with httpx.Client(**kwargs) as client:
            resp = client.post(url, json=payload)
            return 200 <= resp.status_code < 300
    except Exception:
        return False
