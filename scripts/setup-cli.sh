#!/bin/bash
# Configure Solana CLI to use local test validator
#
# Run this after starting the test validator to configure your CLI.

set -e

SOLANA_CLI="/pkg/main/net-p2p.agave.core/bin/solana"

echo "=== Configuring Solana CLI ==="

# Set to localhost
$SOLANA_CLI config set --url http://127.0.0.1:8899

# Generate a keypair if none exists
KEYPAIR_PATH="${HOME}/.config/solana/id.json"
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo "Generating new keypair..."
    /pkg/main/net-p2p.agave.core/bin/solana-keygen new --no-bip39-passphrase -o "$KEYPAIR_PATH"
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
