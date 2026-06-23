#!/usr/bin/env bash
# Redis adapter の動作確認用テストデータを投入する。
# 認証あり / なし両方の container にデータを seed する。
#
# 使い方:
#   cd data/test/redis
#   docker compose up -d
#   ./seed.sh
#   cd ../../..
#   bun run preview --cwd data/test/redis
#   → ブラウザで sidebar に redis-svc / redis-auth が出る
#
# 単一 container に絞る:
#   TARGET=redis-svc ./seed.sh
#   TARGET=redis-auth ./seed.sh

# head | base64 | tr | head のような切り詰めパイプを使うので pipefail は OFF。
# 大きな試験データ生成で前段が SIGPIPE で 141 終了するのは正常動作。
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

REDIS_PASSWORD="${REDIS_PASSWORD:-secret}"
TARGET="${TARGET:-all}"

# redis-cli を docker exec で叩く wrapper。
# $1: container 名, $2: db index, それ以降: redis-cli の引数
rcli() {
  local container="$1"; shift
  local db="$1"; shift
  if [ "$container" = "code-viewer-test-redis-auth" ]; then
    docker exec -i -e "REDISCLI_AUTH=$REDIS_PASSWORD" "$container" \
      redis-cli -3 -n "$db" "$@"
  else
    docker exec -i "$container" redis-cli -3 -n "$db" "$@"
  fi
}

# 指定 container にすべての pattern を seed する。
seed_container() {
  local container="$1"
  echo "==> Seeding $container"

  # 既存データを全 DB クリア
  for db in 0 3 15; do
    rcli "$container" "$db" FLUSHDB >/dev/null
  done

  # ---------- DB 0: 一般的なパターン ----------
  echo "  DB 0: 一般パターン"

  # string
  rcli "$container" 0 SET "string:simple" "hello world" >/dev/null
  rcli "$container" 0 SET "string:empty" "" >/dev/null
  rcli "$container" 0 SET "string:with-newline" $'line1\nline2\nline3' >/dev/null
  rcli "$container" 0 SET "string:japanese" "こんにちは世界" >/dev/null
  rcli "$container" 0 SET "string:emoji" "🎉🚀🔥" >/dev/null
  rcli "$container" 0 SET "string:json" '{"name":"alice","age":30,"nested":{"a":1}}' >/dev/null
  rcli "$container" 0 SET "string:control-chars" $'\x01\x02\x03tab\there' >/dev/null

  # hash
  rcli "$container" 0 HSET "hash:user:42" name "Alice" age "30" email "alice@example.com" >/dev/null
  rcli "$container" 0 HSET "hash:empty-after-del" placeholder "x" >/dev/null
  rcli "$container" 0 HDEL "hash:empty-after-del" placeholder >/dev/null

  # list
  rcli "$container" 0 DEL "list:short" >/dev/null
  rcli "$container" 0 RPUSH "list:short" "a" "b" "c" >/dev/null
  rcli "$container" 0 DEL "list:with-japanese" >/dev/null
  rcli "$container" 0 RPUSH "list:with-japanese" "りんご" "みかん" "ぶどう" >/dev/null

  # set
  rcli "$container" 0 SADD "set:fruits" apple banana cherry >/dev/null

  # zset
  rcli "$container" 0 ZADD "zset:leaderboard" 100 "alice" 250 "bob" 175 "carol" -10 "dave" >/dev/null

  # stream
  rcli "$container" 0 DEL "stream:events" >/dev/null
  rcli "$container" 0 XADD "stream:events" '*' type "login" user "alice" >/dev/null
  rcli "$container" 0 XADD "stream:events" '*' type "view" user "alice" page "/home" >/dev/null
  rcli "$container" 0 XADD "stream:events" '*' type "logout" user "alice" >/dev/null

  # ---------- DB 3: truncation 閾値超え（M1 の確認用） ----------
  echo "  DB 3: truncation 閾値超え"

  # string: 64KB 超え
  local big_string
  big_string=$(head -c 100000 /dev/urandom | base64 | tr -d '\n' | head -c 100000)
  rcli "$container" 3 SET "string:large-100kb" "$big_string" >/dev/null
  rcli "$container" 3 SET "string:exactly-64kb" "$(head -c 65536 /dev/urandom | base64 | tr -d '\n' | head -c 65536)" >/dev/null

  # list: 200 件超え (REDIS_COLLECTION_LIMIT 超え)
  rcli "$container" 3 DEL "list:large-500" >/dev/null
  local list_args=()
  for i in $(seq 1 500); do
    list_args+=("item-$i")
  done
  rcli "$container" 3 RPUSH "list:large-500" "${list_args[@]}" >/dev/null

  # hash: 500 fields
  rcli "$container" 3 DEL "hash:large-500-fields" >/dev/null
  local hash_args=()
  for i in $(seq 1 500); do
    hash_args+=("field-$i" "value-$i")
  done
  rcli "$container" 3 HSET "hash:large-500-fields" "${hash_args[@]}" >/dev/null

  # set: 500 members
  rcli "$container" 3 DEL "set:large-500" >/dev/null
  local set_args=()
  for i in $(seq 1 500); do
    set_args+=("member-$i")
  done
  rcli "$container" 3 SADD "set:large-500" "${set_args[@]}" >/dev/null

  # zset: 500 members
  rcli "$container" 3 DEL "zset:large-500" >/dev/null
  local zset_args=()
  for i in $(seq 1 500); do
    zset_args+=("$i" "score-$i")
  done
  rcli "$container" 3 ZADD "zset:large-500" "${zset_args[@]}" >/dev/null

  # stream: 500 entries
  rcli "$container" 3 DEL "stream:large-500" >/dev/null
  for i in $(seq 1 500); do
    rcli "$container" 3 XADD "stream:large-500" '*' n "$i" >/dev/null
  done

  # ---------- DB 15: binary / 特殊バイト（M3 の確認用） ----------
  echo "  DB 15: binary / 特殊バイト"

  # ピュアバイナリ (UTF-8 invalid)
  local binary_payload
  binary_payload=$(printf '\xff\xfe\xfd\x00\x01\x02\xc3\x28\xa0\xa1')
  rcli "$container" 15 SET "binary:invalid-utf8" "$binary_payload" >/dev/null

  # PNG header
  local png_header
  png_header=$(printf '\x89PNG\r\n\x1a\n')
  rcli "$container" 15 SET "binary:png-header" "$png_header" >/dev/null

  # 末尾 newline
  rcli "$container" 15 SET "string:trailing-newline" $'value with trailing newline\n' >/dev/null
  rcli "$container" 15 SET "string:multiple-trailing-newlines" $'value\n\n\n' >/dev/null

  # hash value が binary
  rcli "$container" 15 HSET "hash:with-binary-value" name "alice" blob "$binary_payload" >/dev/null

  # list with binary
  rcli "$container" 15 DEL "list:with-binary" >/dev/null
  rcli "$container" 15 RPUSH "list:with-binary" "normal" "$binary_payload" "also-normal" >/dev/null

  # 多数 key (SCAN の cursor 確認用) — db 0 と被らない名前で
  echo "  DB 15: SCAN cursor 確認用に 1000 key"
  for i in $(seq 1 1000); do
    rcli "$container" 15 SET "scan:key-$i" "$i" >/dev/null
  done

  echo "  Done: $container"
}

case "$TARGET" in
  all)
    seed_container code-viewer-test-redis
    seed_container code-viewer-test-redis-auth
    ;;
  redis-svc)
    seed_container code-viewer-test-redis
    ;;
  redis-auth)
    seed_container code-viewer-test-redis-auth
    ;;
  *)
    echo "Unknown TARGET: $TARGET (use all / redis-svc / redis-auth)" >&2
    exit 1
    ;;
esac

echo
echo "Seed 完了。次のコマンドで preview server を起動:"
echo "  cd $(git rev-parse --show-toplevel 2>/dev/null || pwd)"
echo "  bun run preview --cwd data/test/redis"
echo
echo "確認パターン:"
echo "  DB 0  一般パターン (string/hash/list/set/zset/stream)"
echo "  DB 3  truncation 閾値超え (M1 検証)"
echo "  DB 15 binary / 特殊バイト + SCAN cursor (M3 + SCAN 検証)"
