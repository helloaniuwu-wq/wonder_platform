from __future__ import annotations


class CircuitOpenError(RuntimeError):
    """Raised under R6 when an external data source refuses access (HTTP 401/403/429)."""

    def __init__(self, source: str, status_code: int | None, detail: str) -> None:
        self.source = source
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"[R6 CIRCUIT OPEN] source={source} status={status_code}: {detail}")
