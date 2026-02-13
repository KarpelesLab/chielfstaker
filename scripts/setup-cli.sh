#!/bin/bash
# Configure Solana CLI to use local test validator
#
# Run this after starting the test validator to configure your CLI.

set -e

AGAVE_LOCAL="$HOME/.local/share/solana/install/active_release/bin"
if [ -x "/pkg/main/net-p2p.agave.core/bin/solana" ]; then
    SOLANA_BIN="/pkg/main/net-p2p.agave.core/bin"
elif [ -x "$AGAVE_LOCAL/solana" ]; then
    SOLANA_BIN="$AGAVE_LOCAL"
else
    SOLANA_BIN=""
fi
SOLANA_CLI="${SOLANA_BIN:+$SOLANA_BIN/}solana"

echo "=== Configuring Solana CLI ==="

# Set to localhost
$SOLANA_CLI config set --url http://127.0.0.1:8899

# Generate a keypair if none exists
KEYPAIR_PATH="${HOME}/.config/solana/id.json"
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo "Generating new keypair..."
    ${SOLANA_BIN:+$SOLANA_BIN/}solana-keygen new --no-bip39-passphrase -o "$KEYPAIR_PATH"
fi

# Show config
echo ""
echo "Current configuration:"
$SOLANA_CLI config get

# Request airdrop
echo ""
echo "Requesting airdrop..."
$SOLANA_CLI airdrop 100

# Show balance
echo ""
echo "Balance:"
$SOLANA_CLI balance
