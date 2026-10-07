#!/usr/bin/env bash
# Jalankan SELURUH smoke test dari kondisi DB bersih.
# Prasyarat: server hidup di PORT=3001.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"

TOTAL_PASS=0
TOTAL_FAIL=0
SUITES_OK=0
SUITES_ERR=0

run_suite() {
  local name="$1"; shift
  echo ""
  echo "══════════════════════════════════════════════════════"
  echo "  SUITE: $name"
  echo "══════════════════════════════════════════════════════"
  bun tests/reset-test-data.ts > /dev/null 2>&1
  local out
  out=$("$@" 2>&1)
  echo "$out" | grep -E '^PASS:|^  FAIL|FAIL:' || true
  local p f
  p=$(echo "$out" | grep -oE '^PASS: [0-9]+' | grep -oE '[0-9]+' | tail -1)
  f=$(echo "$out" | grep -oE 'FAIL: [0-9]+' | grep -oE '[0-9]+' | tail -1)
  if [ -z "$p" ]; then
    echo "  !! suite tidak menghasilkan ringkasan (crash?)"
    echo "$out" | tail -20
    SUITES_ERR=$((SUITES_ERR+1))
    return
  fi
  TOTAL_PASS=$((TOTAL_PASS+p))
  TOTAL_FAIL=$((TOTAL_FAIL+${f:-0}))
  if [ "${f:-0}" -eq 0 ]; then SUITES_OK=$((SUITES_OK+1)); else SUITES_ERR=$((SUITES_ERR+1)); fi
}

run_suite "regresi Sprint 1-3" bun tests/regression.smoke.ts
run_suite "Sprint 3 (bash+curl)" bash tests/sprint3.smoke.sh
run_suite "Sprint 3 (bun+fetch)" bun tests/sprint3.smoke.ts
run_suite "Sprint 4 (reports/moderasi/trust/swagger)" bun tests/sprint4.smoke.ts

echo ""
echo "══════════════════════════════════════════════════════"
echo "  TOTAL: PASS $TOTAL_PASS   FAIL $TOTAL_FAIL"
echo "  Suite lulus: $SUITES_OK   Suite bermasalah: $SUITES_ERR"
echo "══════════════════════════════════════════════════════"
[ "$TOTAL_FAIL" -eq 0 ] && [ "$SUITES_ERR" -eq 0 ] && echo "SEMUA HIJAU ✅" || echo "ADA MASALAH ❌"
exit 0
