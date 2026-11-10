#!/bin/bash
set -e

# ==============================================================================
# deploy-cloudflare.sh — Wonder Platform Cloudflare Serverless 一键部署指南脚本
# ==============================================================================

cd "$(dirname "$0")/.."

echo "🚀 [1/5] 检查 Cloudflare 登录状态..."
if ! npx wrangler whoami > /dev/null 2>&1; then
  echo "⚠️ 尚未登录 Cloudflare，正在唤起浏览器登录..."
  npx wrangler login
else
  echo "✅ Cloudflare 已登录："
  npx wrangler whoami
fi

echo ""
echo "📦 [2/5] 检查/创建 Cloudflare R2 存储桶 (wonder-platform-files)..."
npx wrangler r2 bucket create wonder-platform-files || echo "ℹ️ 存储桶可能已存在，继续下一步。"

echo ""
echo "🗄️ [3/5] 检查/创建 Cloudflare D1 数据库 (wonder-db)..."
echo "提示：如果您是首次创建，请运行：npx wrangler d1 create wonder-db"
echo "并将输出中的 database_id 填入 apps/api-worker/wrangler.toml"

read -p "是否需要现在自动创建 D1 数据库？(y/N): " CREATE_D1
if [[ "$CREATE_D1" =~ ^[Yy]$ ]]; then
  npx wrangler d1 create wonder-db
  echo "⚠️ 请将上方打印的 database_id 复制并替换到 apps/api-worker/wrangler.toml 中的 database_id，然后重新执行本脚本。"
  exit 0
fi

echo ""
echo "🔄 [4/5] 迁移数据库表结构与历史数据至云端 D1..."
read -p "是否现在向远程 D1 执行建表与数据导入？(y/N): " EXEC_D1
if [[ "$EXEC_D1" =~ ^[Yy]$ ]]; then
  echo "-> 正在创建数据库表结构 (0001_schema.sql)..."
  npx wrangler d1 execute wonder-db --remote --file=./migrations/0001_schema.sql -y
  echo "-> 正在导入生产种子数据 (0002_seed_data.sql)..."
  npx wrangler d1 execute wonder-db --remote --file=./migrations/0002_seed_data.sql -y
  echo "✅ 远程 D1 数据导入完成！"
fi

echo ""
echo "🚀 [5/5] 部署 Cloudflare Worker 后端 API..."
npx wrangler deploy

echo ""
echo "🎉 部署完成！"
echo "接下来请在 Cloudflare Dashboard 为 Worker 绑定自定义域名（例如 api.wonderwisdom.online）。"
