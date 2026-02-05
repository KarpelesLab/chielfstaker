#!/bin/bash
# Run KKAMKKAMHAE E2E tests with exact compute unit measurements
#
# This script:
# 1. Starts a fresh test validator with all programs deployed
# 2. Runs the E2E test suite measuring exact CU for each operation
# 3. Outputs results to console and optionally to a file

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOLANA_CLI="/pkg/main/net-p2p.agave.core/bin/solana"
VALIDATOR_BIN="/pkg/main/net-p2p.agave.core/bin/solana-test-validator"

# Program paths
KKAMKKAMHAE_SO="$PROJECT_DIR/target/deploy/kkamkkamhae.so"
KKAMKKAMHAE_KEYPAIR="$PROJECT_DIR/target/deploy/kkamkkamhae-keypair.json"
ZK_VERIFIER_SO="$PROJECT_DIR/target/deploy/zk_verifier.so"
ZK_VERIFIER_KEYPAIR="$PROJECT_DIR/target/deploy/zk_verifier-keypair.json"
BN254_BENCHMARK_SO="$PROJECT_DIR/target/deploy/bn254_benchmark.so"
BN254_BENCHMARK_KEYPAIR="$PROJECT_DIR/target/deploy/bn254_benchmark-keypair.json"

LEDGER_DIR="/tmp/kkamkkamhae-e2e-test"
LOG_FILE="$PROJECT_DIR/e2e-cu-results.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "========================================================"
echo "  KKAMKKAMHAE E2E COMPUTE UNIT TEST"
echo "========================================================"
echo ""

# Check programs exist
for program in "$KKAMKKAMHAE_SO" "$ZK_VERIFIER_SO" "$BN254_BENCHMARK_SO"; do
    if [ ! -f "$program" ]; then
        echo -e "${RED}Error: $(basename $program) not found${NC}"
        echo "Run: ./scripts/build-sbf.sh"
        exit 1
    fi
done

# Get program IDs
KKAMKKAMHAE_ID=$("$SOLANA_CLI" address -k "$KKAMKKAMHAE_KEYPAIR")
ZK_ID=$("$SOLANA_CLI" address -k "$ZK_VERIFIER_KEYPAIR")
BN254_ID=$("$SOLANA_CLI" address -k "$BN254_BENCHMARK_KEYPAIR")

echo "Program IDs:"
echo "  KKAMKKAMHAE:  $KKAMKKAMHAE_ID"
echo "  ZK Verifier:  $ZK_ID"
echo "  BN254:        $BN254_ID"
echo ""

# Kill any existing validator
pkill -f "solana-test-validator" 2>/dev/null || true
sleep 2

# Clean ledger
rm -rf "$LEDGER_DIR"

# Start validator
echo -e "${YELLOW}Starting test validator...${NC}"
"$VALIDATOR_BIN" \
    --ledger "$LEDGER_DIR" \
    --rpc-port 8899 \
    --faucet-port 9900 \
    --compute-unit-limit 1400000 \
    --bpf-program "$KKAMKKAMHAE_ID" "$KKAMKKAMHAE_SO" \
    --bpf-program "$ZK_ID" "$ZK_VERIFIER_SO" \
    --bpf-program "$BN254_ID" "$BN254_BENCHMARK_SO" \
    --quiet \
    &
VALIDATOR_PID=$!

# Cleanup on exit
cleanup() {
    echo ""
    echo "Stopping validator..."
    kill $VALIDATOR_PID 2>/dev/null || true
    wait $VALIDATOR_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for validator
echo "Waiting for validator (PID: $VALIDATOR_PID)..."
for i in {1..30}; do
    if "$SOLANA_CLI" cluster-version --url http://localhost:8899 &>/dev/null; then
        echo -e "${GREEN}Validator ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Validator failed to start${NC}"
        exit 1
    fi
    sleep 1
done

# Configure CLI
"$SOLANA_CLI" config set --url http://localhost:8899 &>/dev/null

# Airdrop
echo -e "\n${YELLOW}Requesting airdrop...${NC}"
"$SOLANA_CLI" airdrop 1000 --url http://localhost:8899

echo ""
echo "========================================================"
echo "  RUNNING E2E TESTS"
echo "========================================================"
echo ""

cd "$PROJECT_DIR"

# Build the benchmark client if needed
if [ ! -f "target/release/run-benchmarks" ] || [ "$KKAMKKAMHAE_SO" -nt "target/release/run-benchmarks" ]; then
    echo -e "${YELLOW}Building benchmark client...${NC}"
    cargo build --release -p benchmark-client 2>&1 | tail -5
fi

# Run the E2E test
echo ""
echo -e "${CYAN}Running KKAMKKAMHAE E2E test...${NC}"
echo ""

./target/release/run-benchmarks --kkamkkamhae 2>&1 | tee "$LOG_FILE"

echo ""
echo "========================================================"
echo "  TEST COMPLETE"
echo "========================================================"
echo ""
echo "Results saved to: $LOG_FILE"
echo ""
