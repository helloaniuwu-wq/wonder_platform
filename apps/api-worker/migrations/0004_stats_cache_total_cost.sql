-- 0004: 为组合统计缓存补充「投入本金」字段
--
-- 背景：迁移到 TypeScript 后，报告接口的投入本金口径被算成「持仓成本 + 现金余额」，
-- 把累计分红现金误当新增本金，导致 ROI / CAGR 系统性低估。
-- 修复后 calculateNav() 以「净入金 Σ CASH_IN − Σ CASH_OUT」为准，
-- 需要把该值一并落进缓存，否则 /report/:id 的缓存分支无法还原正确本金。

ALTER TABLE portfolio_stats_cache ADD COLUMN total_cost REAL;
