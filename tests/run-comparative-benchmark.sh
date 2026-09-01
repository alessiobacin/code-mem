#!/bin/bash
# ==============================================================================
# 🧪 COMPARATIVE BENCHMARK — code-mem (cm) vs detwin-class native throughput
# ==============================================================================
#
# Task T1 (cm-bench-hardening) — Round 3, coder-02.
#
# Misure per cm:
#   1. write burst  — N `cm save` sequential CLI invocations (full CLI process cost)
#   2. recall latency — M `cm recall` point queries, wall clock each (p50/p95)
#   3. accuracy — synthetic ground truth: save K facts, query with paraphrases,
#      check the intended fact appears in top-3 recall.
#
# Native-throughput class proxy (detwin 0.9.0 non-standalone-compilable, CrystFEL
# patch — /tmp/detwin-benchmark is GPL-3.0 READ-ONLY, never copied into the
# project): ex-novo C proxy in /tmp/detwin-proxy (open-addressing hash ingest +
# point lookups). DOMAIN ASYMMETRY: detwin processes crystallographic diffraction
# streams (float arrays, SIMD-friendly), cm does natural-language storage with
# embeddings + SQLite. The proxy bounds only the raw "ingest stream + hash
# lookup" class; numbers are NOT apples-to-apples and are reported as such.
#
# Baseline: pre-A2 (commit e7b9aff, A1-only) rebuilt in a /tmp copy, same protocol.
#
# Usage: tests/run-comparative-benchmark.sh [--out DIR] [--save N] [--recall N]
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${OUT_DIR:-$PROJECT_DIR/tests/benchmark-output}"
SAVES="${SAVES:-40}"
RECALLS="${RECALLS:-30}"
QUERIES="${QUERIES:-15}"
CM_BIN="$PROJECT_DIR/bin/cm"
BASELINE_DIR="/tmp/cm-bench-baseline-e7b9aff"
WORK="${WORK:-/tmp/cm-bench-run-$$}"
mkdir -p "$OUT_DIR" "$WORK"

log()  { printf '[bench] %s\n' "$*"; }
fail() { printf '[bench][ERROR] %s\n' "$*"; exit 1; }

# ---------- defensive timeout wrapper (never spawn without timeout) ----------
run_t() { # run_t <timeout_s> <cmd...>
  local t="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$t" "$@" 2>&1
  else "$@" 2>&1; fi
}

# ---------- 1. build proxy if missing ----------
PROXY="/tmp/detwin-proxy/detwin_proxy"
if [[ ! -x "$PROXY" ]]; then
  log "building detwin-class C proxy (ex-novo, /tmp only)"
  mkdir -p /tmp/detwin-proxy
  cat > /tmp/detwin-proxy/detwin_proxy.c <<'CEOF'
/* detwin-proxy: ex-novo C benchmark proxy (open-addressing hash ingest + lookup).
 * Not part of code-mem, not derived from detwin/CrystFEL (GPL-3.0, READ-ONLY source).
 * Usage: detwin_proxy <n_records> <n_queries> [value_size] */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#define CAP (1 << 21)
static uint64_t keys[CAP];
static uint32_t *vals[CAP];
static uint64_t fnv1a(const char *s, size_t n) {
  uint64_t h = 1469598103934665603ULL;
  for (size_t i = 0; i < n; i++) { h ^= (unsigned char)s[i]; h *= 1099511628211ULL; }
  return h;
}
static double now_s(void) {
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec + ts.tv_nsec / 1e9;
}
int main(int argc, char **argv) {
  long n = argc > 1 ? atol(argv[1]) : 100000;
  long q = argc > 2 ? atol(argv[2]) : 10000;
  int vsz = argc > 3 ? atoi(argv[3]) : 64;
  char key[64]; char *val = malloc(vsz); memset(val, 'x', vsz);
  double t0 = now_s(); long inserted = 0;
  for (long i = 0; i < n; i++) {
    int kl = snprintf(key, sizeof key, "record-%ld", i);
    uint64_t h = fnv1a(key, kl);
    size_t idx = h & (CAP - 1);
    while (keys[idx] != 0 && keys[idx] != h) idx = (idx + 1) & (CAP - 1);
    if (keys[idx] == 0) { keys[idx] = h ? h : 1; vals[idx] = malloc(vsz); memcpy(vals[idx], val, vsz); inserted++; }
  }
  double t1 = now_s(); long hits = 0;
  for (long i = 0; i < q; i++) {
    long target = (i * 7919) % n;
    int kl = snprintf(key, sizeof key, "record-%ld", target);
    uint64_t h = fnv1a(key, kl);
    size_t idx = h & (CAP - 1);
    while (keys[idx] != 0) { if (keys[idx] == h) { hits++; break; } idx = (idx + 1) & (CAP - 1); }
  }
  double t2 = now_s();
  fprintf(stderr, "PROXY inserted=%ld lookup_hits=%ld ingest_s=%.6f ingest_ops_per_s=%.0f lookup_s=%.6f lookup_ops_per_s=%.0f\n",
          inserted, hits, t1 - t0, inserted / (t1 - t0), t2 - t1, q / (t2 - t1));
  free(val); return 0;
}
CEOF
  cc -O2 -o "$PROXY" /tmp/detwin-proxy/detwin_proxy.c || fail "proxy build failed"
fi

# ---------- 2. dataset: synthetic ground-truth facts ----------
declare -a FACTS QUERIES_TXT EXPECT
FACTS=()
QUERIES_TXT=()
EXPECT=()
# (fact, paraphrase query) pairs — ground truth: query must surface the fact in top-3
add_pair() { FACTS+=("$1"); QUERIES_TXT+=("$2"); EXPECT+=("$3"); }
add_pair "Il layer di storage di cm usa SQLite in modalita WAL per la concorrenza" "come funziona lo storage del database" "SQLite WAL"
add_pair "L'autenticazione API usa token JWT firmati con HS256" "autenticazione delle richieste API" "JWT"
add_pair "Il sistema di cache ha TTL di 300 secondi per gli oggetti compressi" "durata della cache degli oggetti" "TTL 300"
add_pair "I log vengono ruotati ogni 50 MB e compressi con gzip" "rotazione dei file di log" "50 MB"
add_pair "L'endpoint /health risponde con codice 200 se il database e raggiungibile" "healthcheck dell'applicazione" "/health"
add_pair "Il deploy usa Docker multi-stage per ridurre l'immagine finale" "come viene fatto il deploy" "Docker"
add_pair "I batch job girano ogni notte alle 3 tramite cron" "pianificazione dei job notturni" "cron"
add_pair "La libreria di parsing JSON e simdjson integrata via FFI" "parsing del JSON" "simdjson"
add_pair "Le metriche vengono esportate in formato Prometheus su porta 9090" "esportazione delle metriche" "Prometheus"
add_pair "I backup del database vengono salvati su S3 con crittografia AES-256" "dove finiscono i backup" "S3"
add_pair "Il rate limiting e di 100 richieste al minuto per chiave API" "limiti di velocita delle richieste" "rate limit"
add_pair "La migrazione del database usa uno script idempotente in TypeScript" "come si migra il database" "migrazione"
add_pair "I worker usano la coda Redis con retry esponenziale massimo 5 tentativi" "gestione delle code e retry" "Redis"
add_pair "La documentazione API e generata da OpenAPI 3.1 in CI" "generazione della documentazione" "OpenAPI"
add_pair "Il frontend usa React 19 con server components e streaming SSR" "tecnologie del frontend" "React"

# ---------- 3. benchmark one cm install ----------
# $1 = label, $2 = cm binary path, $3 = work dir
bench_cm() {
  local label="$1" cm="$2" w="$3"
  local csv="$OUT_DIR/benchmark-results.csv"
  [[ -f "$csv" ]] || echo "label,phase,metric,value,unit" >> "$csv"

  cd "$w" || fail "cd $w"
  run_t 60 "$cm" init >/dev/null 2>&1 || true

  # -- 3a. write burst: SAVES sequential `cm save` --
  log "[$label] write burst: $SAVES saves"
  local t_start t_end burst_s
  t_start=$(python3 -c 'import time; print(time.time())')
  local i
  for ((i = 0; i < SAVES; i++)); do
    run_t 30 "$cm" save "${BENCH_FACTS[$((i % ${#BENCH_FACTS[@]}))]} variante $i — ${BENCH_NOISE[$((i % ${#BENCH_NOISE[@]}))]}" >/dev/null 2>&1
  done
  t_end=$(python3 -c 'import time; print(time.time())')
  burst_s=$(python3 -c "print(f'{$t_end - $t_start:.3f}')")
  echo "$label,write,burst_total,$burst_s,s" >> "$csv"
  echo "$label,write,burst_avg_ms,$(python3 -c "print(f'{$burst_s * 1000 / $SAVES:.1f}')"),ms/op" >> "$csv"

  # -- 3b. recall latency: RECALLS `cm recall` queries --
  # warm-up pass first (page cache / node snapshot): cold outliers would
  # otherwise dominate p95 with machine noise, not product behaviour.
  local qwarm="${BENCH_QUERIES[0]}"
  run_t 30 "$cm" recall "$qwarm" >/dev/null 2>&1
  log "[$label] recall latency: $RECALLS queries"
  : > "$w/.lat.txt"
  for ((i = 0; i < RECALLS; i++)); do
    local q ts te d
    q="${BENCH_QUERIES[$((i % ${#BENCH_QUERIES[@]}))]}"
    ts=$(python3 -c 'import time; print(time.time())')
    run_t 30 "$cm" recall "$q" >/dev/null 2>&1
    te=$(python3 -c 'import time; print(time.time())')
    d=$(python3 -c "print(f'{$te - $ts:.3f}')")
    echo "$d" >> "$w/.lat.txt"
  done
  python3 - "$w/.lat.txt" "$csv" "$label" <<'PEOF'
import sys, statistics
lines = [l.strip() for l in open(sys.argv[1]) if l.strip()]
vals = sorted(float(x) for x in lines)
p50 = vals[len(vals)//2]; p95 = vals[int(len(vals)*0.95)-1]
csv, label = sys.argv[2], sys.argv[3]
with open(csv, "a") as f:
    f.write(f"{label},recall,p50,{p50:.3f},s\n{label},recall,p95,{p95:.3f},s\n")
print(f"[bench] [{label}] recall p50={p50:.3f}s p95={p95:.3f}s")
PEOF

  # -- 3c. accuracy: top-3 hit on paraphrase queries --
  log "[$label] accuracy: $QUERIES paraphrase queries (top-3 hit)"
  local hits=0 total=0
  for ((i = 0; i < QUERIES; i++)); do
    local q expect out
    q="${BENCH_QUERIES[$((i % ${#BENCH_QUERIES[@]}))]}"
    expect="${BENCH_EXPECT[$((i % ${#BENCH_EXPECT[@]}))]}"
    out=$(run_t 30 "$cm" recall "$q" 2>/dev/null | head -20)
    total=$((total + 1))
    if printf '%s' "$out" | grep -qi "$expect"; then hits=$((hits + 1)); fi
  done
  python3 - "$hits" "$total" "$csv" "$label" <<'PEOF'
import sys
hits, total, csv, label = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
acc = hits / total if total else 0
with open(csv, "a") as f:
    f.write(f"{label},accuracy,top3_hit_rate,{acc:.3f},ratio\n")
print(f"[bench] [{label}] accuracy top-3: {hits}/{total} = {acc:.1%}")
PEOF
}

# noise facts (non-ground-truth filler so recall must actually discriminate)
BENCH_NOISE=("Nota generica di architettura sul modulo di configurazione" "Reminder di mantenimiento del CI runner" "Appunto sul refactoring del modulo UI" "TODO tecnico sul refactoring dei test e2e")

# flatten pair arrays to plain arrays used by bench_cm
BENCH_FACTS=("${FACTS[@]}")
BENCH_QUERIES=("${QUERIES_TXT[@]}")
BENCH_EXPECT=("${EXPECT[@]}")

# ---------- 4. baseline pre-A2 (e7b9aff) in /tmp copy ----------
log "preparing baseline (A1-only, e7b9aff) in $BASELINE_DIR"
if [[ ! -d "$BASELINE_DIR" ]]; then
  git -C "$PROJECT_DIR" worktree add --detach "$BASELINE_DIR" e7b9aff >/dev/null 2>&1 \
    || { mkdir -p "$BASELINE_DIR"; git -C "$PROJECT_DIR" archive e7b9aff | tar -x -C "$BASELINE_DIR"; }
  (cd "$BASELINE_DIR" && node build/bundle.mjs >/dev/null 2>&1) || fail "baseline bundle build"
fi

# ---------- 5. run both ----------
rm -f "$OUT_DIR/benchmark-results.csv"
B1="$WORK/baseline"; B2="$WORK/current"
mkdir -p "$B1" "$B2"
bench_cm "baseline-e7b9aff" "$BASELINE_DIR/bin/cm" "$B1"
bench_cm "current-postA2"  "$CM_BIN" "$B2"

# ---------- 6. native proxy class ----------
log "native proxy class (domain-asymmetric reference)"
"$PROXY" 100000 10000 2>&1 | tee "$OUT_DIR/proxy.txt" || true

# ---------- 7. summary ----------
python3 - "$OUT_DIR/benchmark-results.csv" <<'PEOF'
import sys, csv
rows = list(csv.DictReader(open(sys.argv[1])))
def get(label, phase, metric):
    for r in rows:
        if r["label"] == label and r["phase"] == phase and r["metric"] == metric:
            return float(r["value"])
    return None
print("\n=== SUMMARY (baseline-e7b9aff vs current-postA2) ===")
for phase, metric, unit in [("write","burst_total","s"), ("write","burst_avg_ms","ms/op"), ("recall","p50","s"), ("recall","p95","s"), ("accuracy","top3_hit_rate","ratio")]:
    b = get("baseline-e7b9aff", phase, metric)
    c = get("current-postA2", phase, metric)
    if b is None or c is None:
        print(f"  {phase}.{metric}: MISSING"); continue
    delta = ((c - b) / b * 100) if b else 0
    print(f"  {phase}.{metric} ({unit}): {b} -> {c} ({delta:+.1f}%)")
print("Native proxy (detwin-class, domain-asymmetric): see proxy.txt — NOT directly comparable.")
PEOF

log "done. results in $OUT_DIR/benchmark-results.csv"
