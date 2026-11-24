import { Env } from "../types";

export interface AlertDispatchResult {
  emailSent: boolean;
  webhookSent: boolean;
  errors: string[];
}

/**
 * Dual-channel alerting for Wonder Quant Watchdog:
 * 1. Primary (cloud-native, reuses existing Worker secrets): Resend Email (RESEND_API_KEY -> ADMIN_EMAIL)
 * 2. Secondary (optional instant mobile card): Feishu/Lark or generic JSON Webhook (ALERT_WEBHOOK_URL)
 */
export async function sendQuantAlert(
  env: Env,
  subject: string,
  lines: string[],
  level: "INFO" | "WARN" | "CRITICAL" = "WARN"
): Promise<AlertDispatchResult> {
  const result: AlertDispatchResult = { emailSent: false, webhookSent: false, errors: [] };
  const timestamp = new Date().toISOString();
  const fullSubject = `[Wonder Quant · ${level}] ${subject}`;
  const plainBody = `${fullSubject}\nTime (UTC): ${timestamp}\n\n${lines.map((l) => `- ${l}`).join("\n")}`;

  // 1. Resend Email
  const targetEmail = env.ADMIN_EMAIL || env.ADVISOR_EMAIL;
  if (env.RESEND_API_KEY && targetEmail) {
    try {
      const htmlLines = lines.map((l) => `<li style="margin:6px 0;">${l.replace(/</g, "&lt;")}</li>`).join("");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Wonder Quant Watchdog <noreply@wonderwisdom.online>",
          to: [targetEmail],
          subject: fullSubject,
          html: `<div style="font-family:system-ui,sans-serif;max-width:600px;">
            <h3 style="color:${level === "CRITICAL" ? "#b91c1c" : "#b45309"};">${fullSubject}</h3>
            <p style="color:#6b7280;font-size:13px;">UTC: ${timestamp}</p>
            <ul>${htmlLines}</ul>
          </div>`,
        }),
      });
      if (res.ok) {
        result.emailSent = true;
      } else {
        result.errors.push(`Resend HTTP ${res.status}`);
      }
    } catch (e: any) {
      result.errors.push(`Resend error: ${e?.message || String(e)}`);
    }
  }

  // 2. Feishu / Lark Custom Bot Webhook
  if (env.ALERT_WEBHOOK_URL) {
    try {
      const res = await fetch(env.ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msg_type: "text",
          content: { text: plainBody },
        }),
      });
      if (res.ok) {
        result.webhookSent = true;
      } else {
        result.errors.push(`Webhook HTTP ${res.status}`);
      }
    } catch (e: any) {
      result.errors.push(`Webhook error: ${e?.message || String(e)}`);
    }
  }

  return result;
}
