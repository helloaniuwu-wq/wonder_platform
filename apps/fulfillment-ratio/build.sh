#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==> 正在汇总分红数据集..."
python3 scripts/build_dataset.py

echo "==> 正在编译生成静态页面..."
python3 scripts/build_site.py

echo "==> 编译完成！产出："
ls -lh site/

if [ -d "../wonder-hub/public" ]; then
  mkdir -p ../wonder-hub/public/fr/internal
  cp site/client.html ../wonder-hub/public/fr/index.html
  cp site/client.html ../wonder-hub/public/fr/client.html
  cp site/index.html ../wonder-hub/public/fr/internal/index.html
  echo "==> 已自动同步静态产物至 apps/wonder-hub/public/fr/"
fi
