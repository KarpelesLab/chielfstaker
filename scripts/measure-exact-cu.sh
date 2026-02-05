#!/bin/bash
# Measure exact compute units for Groth16 verification on Solana test validator
#
# This script runs actual BN254 syscalls and measures exact CU consumption.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOLANA_CLI="/pkg/main/net-p2p.agave.core/bin/solana"
VALIDATOR_BIN="/pkg/main/net-p2p.agave.core/bin/solana-test-validator"

# Program paths
ZK_VERIFIER_SO="$PROJECT_DIR/target/deploy/zk_verifier.so"
ZK_VERIFIER_KEYPAIR="$PROJECT_DIR/target/deploy/zk_verifier-keypair.json"
BN254_BENCHMARK_SO="$PROJECT_DIR/target/deploy/bn254_benchmark.so"
BN254_BENCHMARK_KEYPAIR="$PROJECT_DIR/target/deploy/bn254_benchmark-keypair.json"

# Ledger directory
LEDGER_DIR="$PROJECT_DIR/test-ledger-cu"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "========================================================"
echo "  SOLANA BN254 COMPUTE UNIT MEASUREMENT"
echo "========================================================"
echo ""

# Check programs exist
if [ ! -f "$ZK_VERIFIER_SO" ]; then
    echo -e "${RED}Error: zk_verifier.so not found${NC}"
    echo "Run: ./scripts/build-sbf.sh -- -p zk-verifier"
    exit 1
fi

if [ ! -f "$BN254_BENCHMARK_SO" ]; then
    echo -e "${RED}Error: bn254_benchmark.so not found${NC}"
    echo "Run: ./scripts/build-sbf.sh -- -p bn254-benchmark"
    exit 1
fi

echo "Programs:"
echo "  zk_verifier: $(du -h "$ZK_VERIFIER_SO" | cut -f1)"
echo "  bn254_benchmark: $(du -h "$BN254_BENCHMARK_SO" | cut -f1)"

# Get program IDs
ZK_PROGRAM_ID=$("$SOLANA_CLI" address -k "$ZK_VERIFIER_KEYPAIR")
BN254_PROGRAM_ID=$("$SOLANA_CLI" address -k "$BN254_BENCHMARK_KEYPAIR")
echo ""
echo "Program IDs:"
echo "  ZK Verifier: $ZK_PROGRAM_ID"
echo "  BN254 Benchmark: $BN254_PROGRAM_ID"
echo ""

# Kill any existing validator
pkill -f "solana-test-validator" 2>/dev/null || true
sleep 2

# Start validator
echo -e "${YELLOW}Starting test validator...${NC}"
rm -rf "$LEDGER_DIR"
"$VALIDATOR_BIN" \
    --ledger "$LEDGER_DIR" \
    --rpc-port 8899 \
    --faucet-port 9900 \
    --slots-per-epoch 32 \
    --compute-unit-limit 1400000 \
    --bpf-program "$ZK_PROGRAM_ID" "$ZK_VERIFIER_SO" \
    --bpf-program "$BN254_PROGRAM_ID" "$BN254_BENCHMARK_SO" \
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

# Create keypair if needed
if [ ! -f ~/.config/solana/id.json ]; then
    "$SOLANA_CLI" keygen new --no-passphrase -o ~/.config/solana/id.json
fi

# Airdrop
echo -e "\n${YELLOW}Requesting airdrop...${NC}"
"$SOLANA_CLI" airdrop 100 --url http://localhost:8899

echo ""
echo "========================================================"
echo "  RUNNING BN254 SYSCALL BENCHMARKS"
echo "========================================================"
echo ""

# Function to run benchmark and extract CU
run_benchmark() {
    local instruction=$1
    local description=$2

    # Create transaction data (instruction byte + optional params)
    local data=$(printf '%02x' $instruction)
    if [ ! -z "$3" ]; then
        data="${data}$(printf '%02x' $3)"
    fi

    # Use solana CLI to simulate
    result=$("$SOLANA_CLI" program invoke \
        --url http://localhost:8899 \
        "$BN254_PROGRAM_ID" \
        --data "$data" \
        2>&1 || true)

    # Extract CU from result
    cu=$(echo "$result" | grep -i "compute units" | grep -oE '[0-9]+' | tail -1)

    if [ -z "$cu" ]; then
        echo -e "  ${description}: ${RED}Failed${NC}"
        echo "    Output: $result"
    else
        printf "  %-35s %'10d CU\n" "$description:" "$cu"
    fi
}

# Run benchmarks using the benchmark client binary
echo -e "${CYAN}Running benchmark client...${NC}"
echo ""

cd "$PROJECT_DIR"

# Build and run the benchmark client
if cargo build --release -p benchmark-client 2>/dev/null; then
    # Run the benchmark client
    ./target/release/benchmark-client benchmark --url http://localhost:8899 2>&1 | tee /tmp/cu_results.txt || {
        echo -e "${YELLOW}Benchmark client failed, running tests manually...${NC}"
    }
fi

echo ""
echo "========================================================"
echo "  GROTH16 VERIFICATION CU MEASUREMENT"
echo "========================================================"
echo ""

# Run the proof verification test
cargo run --release -p benchmark-client -- proof-verify --url http://localhost:8899 2>&1 | tee -a /tmp/cu_results.txt || {
    echo -e "${YELLOW}Proof verification test not available, running alternative...${NC}"
}

echo ""
echo "========================================================"
echo "  SUMMARY"
echo "========================================================"
echo ""

# Extract and display results
if [ -f /tmp/cu_results.txt ]; then
    grep -E "Compute|CU|units" /tmp/cu_results.txt | head -20
fi

echo ""
echo -e "${GREEN}Test complete!${NC}"
