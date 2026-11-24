import { Env } from "../types";
import { sendQuantAlert } from "./alerting";

export interface WatchdogFinding {
  code: "PC_OFFLINE" | "PIPELINE_STALE" | "AIA_VALUATION_LAG" | "FETCH_DEGRADED";
  severity: "WARN" | "CRITICAL";
  message: string;
}

export interface WatchdogReport {
  checkedAt: string;
  healthy: boolean;
  findings: WatchdogFinding[];
  alertSent: boolean;
  suppressedByCooldown: boolean;
}

/**
 * Count weekday business days strictly between two ISO dates (YYYY-MM-DD).
 * Skips Saturdays and Sundays so weekend pauses never trigger false staleness alarms.
 */
export function countBusinessDaysBetween(startIso: string, endIso: string): number {
  const s = new Date(`${startIso.slice(0, 10)}T00:00:00Z`);
  const e = new Date(`${endIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return 0;

  let days = 0;
  const cursor = new Date(s.getTime() + 86400_000);
  while (cursor <= e) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      days++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Cloudflare Cron Watchdog (D1 Free-Tier optimized: reads at most 2 rows per Cron execution).
 * Evaluates dual freshness thresholds:
 * - Heartbeat gap > 6h -> PC_OFFLINE (CRITICAL)
 * - Pipeline fetch success gap > 2 business days -> PIPELINE_STALE (CRITICAL)
 * - AIA ILAS valuation_date gap > 4 business days -> AIA_VALUATION_LAG (WARN, tolerates HK/LU holidays & T+2)
 * - Latest run failed / circuit_open / failure_rate > 20% -> FETCH_DEGRADED (CRITICAL)
 */
export async function runQuantWatchdog(env: Env, now: Date = new Date()): Promise<WatchdogReport> {
  const checkedAt = now.toISOString();
  const findings: WatchdogFinding[] = [];

  let hb: any = null;
  let lastRun: any = null;
  try {
    hb = await env.DB.prepare("SELECT * FROM wq_heartbeat ORDER BY last_seen_at DESC LIMIT 1").first<any>();
    lastRun = await env.DB.prepare(
      "SELECT * FROM wq_pipeline_runs ORDER BY started_at DESC LIMIT 1"
    ).first<any>();
  } catch (e: any) {
    // Migration 0005 not yet applied on DB -> silently skip without breaking portfolio Cron
    console.warn("[quant-watchdog] wq tables unavailable, skipping:", e?.message);
    return { checkedAt, healthy: true, findings: [], alertSent: false, suppressedByCooldown: false };
  }

  // If Wonder Quant has never pushed a heartbeat yet (initial pre-activation state), stay quiet
  if (!hb) {
    return { checkedAt, healthy: true, findings: [], alertSent: false, suppressedByCooldown: false };
  }

  const nowMs = now.getTime();
  const todayIso = checkedAt.slice(0, 10);

  // 1. Heartbeat freshness (> 6 hours)
  if (hb.last_seen_at) {
    const seenMs = Date.parse(hb.last_seen_at);
    if (!Number.isNaN(seenMs)) {
      const gapHours = (nowMs - seenMs) / 3600_000;
      if (gapHours > 6) {
        findings.push({
          code: "PC_OFFLINE",
          severity: "CRITICAL",
          message: `Windows PC (${hb.host_id}) 心跳已中断 ${gapHours.toFixed(1)} 小时（最后在线 ${hb.last_seen_at}）`,
        });
      }
    }
  }

  // 2. Pipeline execution freshness (> 2 business days)
  if (hb.last_fetch_ok_at) {
    const bdays = countBusinessDaysBetween(hb.last_fetch_ok_at, todayIso);
    if (bdays > 2) {
      findings.push({
        code: "PIPELINE_STALE",
        severity: "CRITICAL",
        message: `Wonder Quant 数据抓取已超过 ${bdays} 个工作日未成功更新（上次成功 ${hb.last_fetch_ok_at}）`,
      });
    }
  }

  // 3. AIA ILAS valuation date staleness (> 4 business days, tolerant of HK/EU holidays + T+2 lag)
  if (hb.last_aia_val_date) {
    const aiaBdays = countBusinessDaysBetween(hb.last_aia_val_date, todayIso);
    if (aiaBdays > 4) {
      findings.push({
        code: "AIA_VALUATION_LAG",
        severity: "WARN",
        message: `AIA 卓达智悦2 最新估值日 ${hb.last_aia_val_date} 已滞后 ${aiaBdays} 个工作日（请核查香港假期或 FundInfo2 接口状态）`,
      });
    }
  }

  // 4. Latest pipeline run status / failure rate > 20%
  if (lastRun) {
    const failRate = Number(lastRun.failure_rate || 0);
    if (lastRun.status === "failed" || lastRun.status === "circuit_open" || failRate > 0.2) {
      findings.push({
        code: "FETCH_DEGRADED",
        severity: "CRITICAL",
        message: `最近批处理 (${lastRun.run_id}) 状态异常: status=${lastRun.status}, 失败率 ${(failRate * 100).toFixed(1)}% (${lastRun.failed_funds}/${lastRun.total_funds})`,
      });
    }
  }

  if (findings.length === 0) {
    return { checkedAt, healthy: true, findings: [], alertSent: false, suppressedByCooldown: false };
  }

  // 6-hour deduplication cooldown to avoid alert storms
  const fingerprint = findings
    .map((f) => f.code)
    .sort()
    .join("+");
  const lastAlertMs = hb.last_alert_sent_at ? Date.parse(hb.last_alert_sent_at) : 0;
  const sameFingerprintWithin6h =
    hb.last_alert_fingerprint === fingerprint && !Number.isNaN(lastAlertMs) && nowMs - lastAlertMs < 6 * 3600_000;

  if (sameFingerprintWithin6h) {
    return { checkedAt, healthy: false, findings, alertSent: false, suppressedByCooldown: true };
  }

  const maxSeverity = findings.some((f) => f.severity === "CRITICAL") ? "CRITICAL" : "WARN";
  const dispatch = await sendQuantAlert(
    env,
    `检测到 ${findings.length} 项数据管道异常 (${fingerprint})`,
    findings.map((f) => `[${f.code}] ${f.message}`),
    maxSeverity
  );

  if (dispatch.emailSent || dispatch.webhookSent) {
    try {
      await env.DB.prepare(
        "UPDATE wq_heartbeat SET last_alert_sent_at = ?, last_alert_fingerprint = ? WHERE host_id = ?"
      )
        .bind(checkedAt, fingerprint, hb.host_id)
        .run();
    } catch {
      // ignore
    }
  }

  return {
    checkedAt,
    healthy: false,
    findings,
    alertSent: dispatch.emailSent || dispatch.webhookSent,
    suppressedByCooldown: false,
  };
}
