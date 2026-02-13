#!/bin/bash
# Run full E2E tests for ChiefStaker
#
# This script:
# 1. Builds the program
# 2. Starts a test validator
# 3. Deploys the program
# 4. Runs TypeScript E2E tests
# 5. Cleans up

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AGAVE_LOCAL="$HOME/.local/share/solana/install/active_release/bin"
if [ -x "/pkg/main/net-p2p.agave.core/bin/solana" ]; then
    SOLANA_BIN="/pkg/main/net-p2p.agave.core/bin"
elif [ -x "$AGAVE_LOCAL/solana" ]; then
    SOLANA_BIN="$AGAVE_LOCAL"
else
    SOLANA_BIN=""
fi
SOLANA_CLI="${SOLANA_BIN:+$SOLANA_BIN/}solana"
VALIDATOR_BIN="${SOLANA_BIN:+$SOLANA_BIN/}solana-test-validator"

cd "$PROJECT_DIR"

echo "=== ChiefStaker E2E Test Runner ==="
echo ""

# Step 1: Build
echo "Step 1: Building program..."
./scripts/build-sbf.sh
echo ""

# Step 2: Start validator in background
echo "Step 2: Starting test validator..."
LEDGER_DIR="$PROJECT_DIR/test-ledger"
rm -rf "$LEDGER_DIR"

$VALIDATOR_BIN \
    --ledger "$LEDGER_DIR" \
    --rpc-port 8899 \
    --faucet-port 9900 \
    --slots-per-epoch 32 \
    --log &
VALIDATOR_PID=$!

# Wait for validator to start
echo "Waiting for validator to start..."
sleep 5

# Check validator is running
if ! kill -0 $VALIDATOR_PID 2>/dev/null; then
    echo "ERROR: Validator failed to start"
    exit 1
fi

# Configure CLI
$SOLANA_CLI config set --url http://localhost:8899 --keypair ~/.config/solana/id.json 2>/dev/null || true

# Function to cleanup
cleanup() {
    echo ""
    echo "Cleaning up..."
    if [ -n "$VALIDATOR_PID" ]; then
        kill $VALIDATOR_PID 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Step 3: Deploy program
echo ""
echo "Step 3: Deploying program..."
PROGRAM_SO="$PROJECT_DIR/target/deploy/chiefstaker.so"
if [ ! -f "$PROGRAM_SO" ]; then
    echo "ERROR: Program not found at $PROGRAM_SO"
    exit 1
fi

$SOLANA_CLI program deploy "$PROGRAM_SO"
echo ""

# Step 4: Run TypeScript tests
echo "Step 4: Running E2E tests..."
cd "$PROJECT_DIR/tests/typescript"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing test dependencies..."
    npm install
fi

# Run tests
npm test

echo ""
echo "=== E2E Tests Complete ==="
