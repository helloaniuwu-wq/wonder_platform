import Link from "next/link";

/**
 * 诊断中心（占位页）
 *
 * 2026-11-10：风险测评链路整体下线 —— 提交端点 /api/assessment/submit 未随迁移
 * 迁到 Cloudflare Worker，且原评分逻辑在后端，前端无法独立出结果。
 * 家庭健康诊断问卷（/assessment/questionnaire）与结果页（/assessment/result）已删除。
 * 家庭财务体检工具（/family-finance）代码保留在仓库内，暂不对外挂入口。
 */
export default function AssessmentIndex() {
  return (
    <main className="min-h-screen bg-background text-foreground px-6 py-32">
      <div className="max-w-2xl mx-auto text-center">
        <div className="text-6xl mb-8">🛠️</div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6 text-card-foreground">
          诊断中心即将上线
        </h1>
        <p className="text-lg text-foreground/70 font-light leading-relaxed mb-4">
          风险测评与家庭财务体检正在重新设计，改好后会在这里与大家见面。
        </p>
        <p className="text-base text-foreground/50 font-light leading-relaxed mb-12">
          在此之前，如果您希望对自己的资产、负债与被动现金流做一次完整梳理，
          可以直接联系顾问安排一对一沟通。
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/"
            className="h-12 px-8 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity inline-flex items-center justify-center"
          >
            返回首页
          </Link>
          <Link
            href="/blog"
            className="h-12 px-8 rounded-xl border border-border text-foreground/70 text-sm font-medium hover:text-foreground hover:bg-card transition-colors inline-flex items-center justify-center"
          >
            查看专业洞察
          </Link>
        </div>
      </div>
    </main>
  );
}
