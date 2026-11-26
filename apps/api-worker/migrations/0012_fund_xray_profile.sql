-- 为基金产品主档新增深度组合透视画像（行业分布、区域分布、股债风格箱、信用评级与估值快照）
ALTER TABLE wq_funds ADD COLUMN xray_profile_json TEXT;
