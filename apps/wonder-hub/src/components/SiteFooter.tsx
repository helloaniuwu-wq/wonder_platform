/**
 * 全站页脚免责声明
 *
 * 合规口径参照 wonder_hub_funnel_v3.md 的公开层约束：
 * 不出现保险公司名称、具体产品、代理人身份或任何招揽性措辞。
 * 只做用途与风险陈述，供所有页面共用。
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-card/40">
      <div className="max-w-4xl mx-auto px-6 py-10 text-sm text-foreground/60 font-light leading-relaxed">
        <p className="text-card-foreground font-medium mb-4">
          WONDER · 独立研究与数据平台
        </p>
        <p className="mb-3">
          本网站所有内容仅供一般资讯及教育参考，不构成投资建议、要约、招揽或任何金融产品的推介。所载数据力求准确，但不保证完整或适时；投资涉及风险，过往表现不代表将来表现。
        </p>
        <p className="mb-6">
          阅者应因应自身情况独立判断，并在有需要时咨询独立持牌专业人士。
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-5 border-t border-border/50 text-xs text-foreground/45">
          <span>© 2026 WONDER</span>
          <span>内容与数据仅供研究参考</span>
        </div>
      </div>
    </footer>
  );
}
