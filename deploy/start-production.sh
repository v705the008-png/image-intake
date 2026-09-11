#!/bin/zsh
# 本番サーバーを起動する（launchd から呼ばれる想定。手で実行してもよい）
#
# - Mac がスリープすると外から繋がらなくなるので、caffeinate でこのプロセスが動いている間だけスリープを止める
# - ビルドは事前に `npm run build:prod` で済ませておく（ここでは起動だけ）
set -euo pipefail

APP_DIR="${0:A:h:h}"
cd "$APP_DIR"

# launchd には PATH が引き継がれないので、Homebrew の node を見つけられるようにする
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV=production

if [[ ! -d .next-prod ]]; then
  echo "[image-intake] .next-prod がありません。先に npm run build:prod を実行してください" >&2
  exit 1
fi

exec caffeinate -is npm run start:prod
