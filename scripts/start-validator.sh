#!/bin/bash
# Start Solana test validator for ZK proof testing
#
# This script starts a local Solana test validator with appropriate settings
# for testing ZK proof verification programs.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VALIDATOR_BIN="/pkg/main/net-p2p.agave.core/bin/solana-test-validator"
SOLANA_CLI="/pkg/main/net-p2p.agave.core/bin/solana"

# Ledger directory
LEDGER_DIR="${PROJECT_DIR}/test-ledger"

# Configuration
SLOTS_PER_EPOCH=32  # Shorter epochs for testing

# Default CU limit - can be overridden with --high-cu flag for Halo2 benchmarks
COMPUTE_UNIT_LIMIT=1400000

# Check for high CU limit flag (for pure BPF Halo2 benchmarks)
HIGH_CU=false
for arg in "$@"; do
    if [ "$arg" = "--high-cu" ]; then
        HIGH_CU=true
        COMPUTE_UNIT_LIMIT=500000000  # 500M CU for measuring Halo2 costs
    fi
done

echo "=== KKAMKKAMHAE Test Validator ==="
echo "Ledger: $LEDGER_DIR"
echo "Compute Unit Limit: $COMPUTE_UNIT_LIMIT"
echo ""

# Clean ledger if requested
RESET=false
for arg in "$@"; do
    if [ "$arg" = "--reset" ]; then
        RESET=true
        echo "Resetting ledger..."
        rm -rf "$LEDGER_DIR"
    fi
done

# Create ledger directory
mkdir -p "$LEDGER_DIR"

# Filter out our custom args before passing to validator
VALIDATOR_ARGS=""
for arg in "$@"; do
    if [ "$arg" != "--reset" ] && [ "$arg" != "--high-cu" ]; then
        VALIDATOR_ARGS="$VALIDATOR_ARGS $arg"
    fi
done

# Start validator
echo "Starting test validator..."
exec "$VALIDATOR_BIN" \
    --ledger "$LEDGER_DIR" \
    --rpc-port 8899 \
    --faucet-port 9900 \
    --slots-per-epoch $SLOTS_PER_EPOCH \
    --compute-unit-limit $COMPUTE_UNIT_LIMIT \
    --log \
    $VALIDATOR_ARGS
