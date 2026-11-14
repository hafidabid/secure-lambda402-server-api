#!/usr/bin/env bash
# Preflight checks for SecureLambda deployment.
# Verifies that the environment, dependencies, and running services are ready for operation.
#
# Usage:
#   ./ops/preflight.sh
#
# Exit codes:
#   0 = all hard checks passed (warnings allowed)
#   1 = one or more hard checks failed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNED=0

# Helper to print result
check_pass() {
    echo -e "${GREEN}PASS${NC} $1"
    PASSED=$((PASSED + 1))
}

check_fail() {
    echo -e "${RED}FAIL${NC} $1"
    FAILED=$((FAILED + 1))
}

check_warn() {
    echo -e "${YELLOW}WARN${NC} $1"
    WARNED=$((WARNED + 1))
}

echo "=== SecureLambda Preflight Checks ==="
echo ""

# Get API port from env or default
API_PORT="${API_PORT:-3000}"

# ========== Environment Variables ==========
echo "1. Environment Variables"

# Check a representative set of required env vars
if [[ -n "${DATABASE_URL}" ]] && [[ "${DATABASE_URL}" != "" ]]; then
    check_pass "DATABASE_URL is set"
else
    check_fail "DATABASE_URL is not set"
fi

if [[ -n "${REDIS_URL}" ]] && [[ "${REDIS_URL}" != "" ]]; then
    check_pass "REDIS_URL is set"
else
    check_fail "REDIS_URL is not set"
fi

if [[ -n "${STORAGE_ENDPOINT}" ]] && [[ "${STORAGE_ENDPOINT}" != "" ]]; then
    check_pass "STORAGE_ENDPOINT is set"
else
    check_fail "STORAGE_ENDPOINT is not set"
fi

echo ""

# ========== API Health Checks ==========
echo "2. API Health"

# Check /healthz
if curl -s -f "http://localhost:${API_PORT}/healthz" > /dev/null 2>&1; then
    check_pass "GET http://localhost:${API_PORT}/healthz => 200"
else
    check_fail "GET http://localhost:${API_PORT}/healthz (API may not be running or port ${API_PORT} not open)"
fi

# Check /readyz
if curl -s -f "http://localhost:${API_PORT}/readyz" > /dev/null 2>&1; then
    check_pass "GET http://localhost:${API_PORT}/readyz => 200"
else
    check_fail "GET http://localhost:${API_PORT}/readyz (readiness check failed)"
fi

echo ""

# ========== Docker Compose Services ==========
echo "3. Docker Compose Services"

# Check if docker compose is available
if ! command -v docker compose &> /dev/null; then
    check_warn "docker compose command not found; skipping service checks"
else
    # Check postgres
    if docker compose ps postgres 2>/dev/null | grep -q "postgres.*running"; then
        check_pass "postgres is running"
    else
        check_fail "postgres is not running (or docker compose is not active)"
    fi

    # Check redis
    if docker compose ps redis 2>/dev/null | grep -q "redis.*running"; then
        check_pass "redis is running"
    else
        check_fail "redis is not running"
    fi

    # Check minio
    if docker compose ps minio 2>/dev/null | grep -q "minio.*running"; then
        check_pass "minio is running"
    else
        check_fail "minio is not running"
    fi
fi

echo ""

# ========== Rust Toolchain (Warning Only) ==========
echo "4. Rust Toolchain (evaluator build)"

if command -v cargo &> /dev/null; then
    check_pass "cargo is available"

    # Check for wasm32-wasip1 target
    if rustup target list --installed 2>/dev/null | grep -q "wasm32-wasip1"; then
        check_pass "wasm32-wasip1 target is installed"
    else
        check_warn "wasm32-wasip1 target not installed; run: rustup target add wasm32-wasip1"
    fi
else
    check_warn "cargo not found; Rust evaluator builds will not work. Install Rust via rustup."
fi

echo ""

# ========== Summary ==========
echo "=== Summary ==="
echo -e "${GREEN}Passed:${NC}  $PASSED"
echo -e "${RED}Failed:${NC}  $FAILED"
echo -e "${YELLOW}Warned:${NC}  $WARNED"
echo ""

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}✗ Preflight FAILED${NC} — fix errors above and re-run"
    exit 1
else
    echo -e "${GREEN}✓ Preflight OK${NC} — deployment ready"
    exit 0
fi
