import { NextRequest, NextResponse } from "next/server"

const PRODUCT_NAMES: Record<string, string> = {
  ec: "雇員補償保險 (EC Insurance)",
  mpf: "強制性公積金 (MPF)",
  medical: "團體醫療保險 (Group Medical)",
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      companyName,
      contactName,
      phone,
      email,
      employees,
      avgSalary,
      industry,
      currentProvider,
      planLevel,
      includeDependents,
      effectDate,
      remarks,
      selectedTypes,
    } = body

    // ── Cloudflare Turnstile 人机验证 ──────────────────────────
    const turnstileToken =
      body["cf-turnstile-response"] ||
      body["cf_turnstile_response"] ||
      body.turnstileToken
    const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET

    if (TURNSTILE_SECRET) {
      if (!turnstileToken) {
        return NextResponse.json({ ok: false, error: "請完成真人安全驗證" }, { status: 400 })
      }

      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || ""
      const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: TURNSTILE_SECRET,
          response: turnstileToken,
          ...(clientIp ? { remoteip: clientIp } : {}),
        }),
      })

      const verifyData = await verifyRes.json()
      if (!verifyData.success || (verifyData.action && verifyData.action !== "insurance_inquiry")) {
        console.warn("[Turnstile] Insurance inquiry verification failed:", verifyData)
        return NextResponse.json({ ok: false, error: "人機安全驗證失敗，請重試" }, { status: 400 })
      }
    }

    // 构建邮件 HTML
    const productsText = (selectedTypes as string[])
      .map((id: string) => PRODUCT_NAMES[id] || id)
      .join("、")

    const html = `
<!DOCTYPE html>
<html lang="zh-HK">
<head><meta charset="UTF-8"><title>企業保險詢價</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  
  <div style="background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 28px 32px;">
      <div style="font-size: 11px; color: #F59E0B; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px;">WONDER HUB</div>
      <h1 style="margin: 0; color: #fff; font-size: 22px; font-weight: 700;">🛡️ 新企業保險詢價</h1>
      <p style="margin: 6px 0 0; color: rgba(255,255,255,0.55); font-size: 13px;">${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}</p>
    </div>
    
    <!-- 险种标签 -->
    <div style="padding: 20px 32px 0;">
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${(selectedTypes as string[]).map((id: string) => `
          <span style="padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700;
            background: ${id === "ec" ? "#FEE2E2" : id === "mpf" ? "#EDE9FE" : "#D1FAE5"};
            color: ${id === "ec" ? "#B91C1C" : id === "mpf" ? "#5B21B6" : "#065F46"};">
            ${PRODUCT_NAMES[id] || id}
          </span>
        `).join("")}
      </div>
    </div>
    
    <!-- 公司信息 -->
    <div style="padding: 24px 32px;">
      <div style="font-size: 11px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">公司資料</div>
      <table style="width: 100%; border-collapse: collapse;">
        ${row("公司名稱", companyName)}
        ${row("聯絡人", contactName)}
        ${row("電話", phone)}
        ${row("電郵", email)}
      </table>
    </div>
    
    <!-- 分割线 -->
    <div style="height: 1px; background: #F3F4F6; margin: 0 32px;"></div>
    
    <!-- 投保要素 -->
    <div style="padding: 24px 32px;">
      <div style="font-size: 11px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">投保要素</div>
      <table style="width: 100%; border-collapse: collapse;">
        ${employees ? row("員工人數", employees) : ""}
        ${avgSalary ? row("平均月薪", avgSalary) : ""}
        ${industry ? row("行業 / 工種", industry) : ""}
        ${currentProvider ? row("現有 MPF 受托人", currentProvider) : ""}
        ${planLevel ? row("醫療計劃級別", planLevel) : ""}
        ${includeDependents ? row("家屬保障", "需要") : ""}
        ${effectDate ? row("期望生效日期", effectDate) : ""}
        ${remarks ? row("備註", remarks) : ""}
      </table>
    </div>
    
    <!-- Footer -->
    <div style="padding: 20px 32px; background: #F9FAFB; border-top: 1px solid #F3F4F6;">
      <p style="margin: 0; font-size: 12px; color: #9CA3AF; text-align: center;">
        此郵件由 WONDER HUB 企業保險詢價系統自動發出 · wonderhub.hk
      </p>
    </div>
  </div>
  
</body>
</html>
`

    // ── 环境变量配置 ──────────────────────────────────────────────────────────
    const ADVISOR_EMAIL = process.env.ADVISOR_EMAIL || ""
    const RESEND_API_KEY = process.env.RESEND_API_KEY || ""

    // 开发模式：仅打印日志，不发送邮件
    if (!RESEND_API_KEY || !ADVISOR_EMAIL) {
      console.log("=== [Insurance Inquiry - DEV MODE] ===")
      console.log("Products:", productsText)
      console.log("Company:", companyName, "| Contact:", contactName)
      console.log("Phone:", phone, "| Email:", email)
      console.log("Employees:", employees, "| Industry:", industry)
      console.log("=====================================")
      return NextResponse.json({ ok: true, mode: "dev" })
    }

    // 生产模式：通过 Resend 发送邮件
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "WONDER HUB 詢價系統 <inquiry@wonderhub.hk>",
        to: [ADVISOR_EMAIL],
        subject: `🛡️ 新企業保險詢價 — ${companyName}（${productsText}）`,
        html,
        reply_to: email,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error("Resend error:", errText)
      return NextResponse.json({ ok: false, error: "郵件發送失敗" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Insurance inquiry API error:", err)
    return NextResponse.json({ ok: false, error: "伺服器錯誤" }, { status: 500 })
  }
}

// ── 工具函数：生成表格行 ──────────────────────────────────────────────────────

function row(label: string, value: string | boolean) {
  if (!value) return ""
  return `
    <tr>
      <td style="padding: 6px 0; font-size: 12px; color: #6B7280; width: 130px; vertical-align: top;">${label}</td>
      <td style="padding: 6px 0; font-size: 13px; color: #111827; font-weight: 600;">${value}</td>
    </tr>
  `
}
