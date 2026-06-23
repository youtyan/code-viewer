#!/usr/bin/env bash
# Elasticsearch adapter の動作確認用テストデータを投入する。
#
# 使い方:
#   cd data/test/elasticsearch
#   docker compose up -d
#   ./seed.sh
#   cd ../../..
#   bun run preview --cwd data/test/elasticsearch
#   → ブラウザで sidebar に es-svc が出る

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CONTAINER="${CONTAINER:-code-viewer-test-es}"

# es_curl: docker exec で container 内から localhost:9200 を叩く。
#   $1: HTTP method, $2: path, $3 (optional): JSON body
es_curl() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    docker exec -i "$CONTAINER" curl -sS \
      -X "$method" \
      -H 'Content-Type: application/json' \
      --data-binary "$body" \
      "http://localhost:9200$path"
  else
    docker exec -i "$CONTAINER" curl -sS \
      -X "$method" \
      "http://localhost:9200$path"
  fi
}

# 起動完了を待つ。docker compose の healthcheck と被るが、CI で seed.sh だけ
# 単独実行されるケースも想定して内側でも poll する。
wait_for_es() {
  local i
  for i in $(seq 1 60); do
    if docker exec -i "$CONTAINER" curl -sf \
      "http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=2s" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "elasticsearch did not become ready" >&2
  exit 1
}

echo "==> waiting for elasticsearch"
wait_for_es

# 既存 index を消す (idempotent な seed)。
echo "==> deleting existing test indices (ignore 404)"
es_curl DELETE "/products" >/dev/null || true
es_curl DELETE "/events" >/dev/null || true
es_curl DELETE "/binary-test" >/dev/null || true
echo

# ---------- products: 基本パターン ----------
echo "==> creating products"
es_curl PUT "/products" '{
  "mappings": {
    "properties": {
      "name":        { "type": "text" },
      "category":    { "type": "keyword" },
      "price":       { "type": "double" },
      "in_stock":    { "type": "boolean" },
      "tags":        { "type": "keyword" },
      "released_at": { "type": "date" },
      "nested_meta": {
        "properties": {
          "manufacturer": { "type": "keyword" },
          "country":      { "type": "keyword" }
        }
      }
    }
  }
}' >/dev/null
echo

products_bulk='{"index":{"_id":"p1"}}
{"name":"Wireless Mouse","category":"electronics","price":29.99,"in_stock":true,"tags":["mouse","wireless"],"released_at":"2024-03-15","nested_meta":{"manufacturer":"Logitech","country":"CH"}}
{"index":{"_id":"p2"}}
{"name":"Mechanical Keyboard","category":"electronics","price":129.50,"in_stock":true,"tags":["keyboard","mechanical","rgb"],"released_at":"2024-06-01","nested_meta":{"manufacturer":"Keychron","country":"HK"}}
{"index":{"_id":"p3"}}
{"name":"USB-C Cable","category":"accessories","price":9.99,"in_stock":false,"tags":["cable","usb-c"],"released_at":"2023-11-20"}
{"index":{"_id":"p4"}}
{"name":"こんにちは キーボード","category":"electronics","price":199.00,"in_stock":true,"tags":["日本語","keyboard"],"released_at":"2025-01-10","nested_meta":{"manufacturer":"Topre","country":"JP"}}
{"index":{"_id":"p5"}}
{"name":"Notebook","category":"stationery","price":4.50,"in_stock":true,"tags":["paper","notebook"],"released_at":"2024-09-01"}
'
es_curl POST "/products/_bulk" "$products_bulk" >/dev/null
echo "  products: 5 docs"

# ---------- events: pagination 検証用 (500 docs) ----------
echo "==> creating events (500 docs, pagination 検証)"
es_curl PUT "/events" '{
  "mappings": {
    "properties": {
      "ts":   { "type": "date" },
      "kind": { "type": "keyword" },
      "user": { "type": "keyword" },
      "page": { "type": "keyword" },
      "n":    { "type": "integer" }
    }
  }
}' >/dev/null

# 500 docs を 100 件ずつ bulk で投入。
events_payload=""
for i in $(seq 1 500); do
  kind="view"
  case $((i % 5)) in
    0) kind="login" ;;
    1) kind="view" ;;
    2) kind="click" ;;
    3) kind="logout" ;;
    4) kind="error" ;;
  esac
  user="user-$((i % 50))"
  page="/page/$((i % 10))"
  events_payload+="{\"index\":{\"_id\":\"e$i\"}}
{\"ts\":\"2026-01-01T00:00:$(printf '%02d' $((i % 60)))Z\",\"kind\":\"$kind\",\"user\":\"$user\",\"page\":\"$page\",\"n\":$i}
"
  if [ $((i % 100)) -eq 0 ]; then
    es_curl POST "/events/_bulk" "$events_payload" >/dev/null
    events_payload=""
    echo "  events: $i / 500"
  fi
done
echo

# ---------- binary-test: base64 / binary フィールド ----------
echo "==> creating binary-test"
es_curl PUT "/binary-test" '{
  "mappings": {
    "properties": {
      "label":   { "type": "keyword" },
      "blob_b64":{ "type": "binary" },
      "note":    { "type": "text" }
    }
  }
}' >/dev/null

binary_bulk='{"index":{"_id":"b1"}}
{"label":"png-header","blob_b64":"iVBORw0KGgo=","note":"PNG signature bytes (base64-encoded)"}
{"index":{"_id":"b2"}}
{"label":"invalid-utf8","blob_b64":"//79APwBAsMo","note":"binary that is not valid UTF-8"}
{"index":{"_id":"b3"}}
{"label":"jp-emoji","note":"こんにちは 🎉 世界"}
'
es_curl POST "/binary-test/_bulk" "$binary_bulk" >/dev/null
echo "  binary-test: 3 docs"

# refresh して直後の検索で見えるようにする。
es_curl POST "/_refresh" >/dev/null

echo
echo "==> seed 完了"
echo "  products    : 5 docs (mapping 検証 + 多言語 + nested)"
echo "  events      : 500 docs (search_after pagination 検証用)"
echo "  binary-test : 3 docs (binary フィールド + emoji)"
echo
echo "次のコマンドで preview server を起動:"
echo "  cd $(git rev-parse --show-toplevel 2>/dev/null || pwd)"
echo "  bun run preview --cwd data/test/elasticsearch"
