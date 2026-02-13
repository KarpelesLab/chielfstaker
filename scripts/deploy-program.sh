#!/bin/bash
# Deploy a Solana program to the test validator
#
# Usage: ./deploy-program.sh <program.so>

set -e

AGAVE_LOCAL="$HOME/.local/share/solana/install/active_release/bin"
if [ -x "/pkg/main/net-p2p.agave.core/bin/solana" ]; then
    SOLANA_CLI="/pkg/main/net-p2p.agave.core/bin/solana"
elif [ -x "$AGAVE_LOCAL/solana" ]; then
    SOLANA_CLI="$AGAVE_LOCAL/solana"
else
    SOLANA_CLI="solana"
fi

if [ -z "$1" ]; then
    echo "Usage: $0 <program.so>"
    exit 1
fi

PROGRAM_SO="$1"

if [ ! -f "$PROGRAM_SO" ]; then
    echo "Error: Program file not found: $PROGRAM_SO"
    exit 1
fi

echo "=== Deploying Program ==="
echo "Program: $PROGRAM_SO"
echo ""

# Deploy
$SOLANA_CLI program deploy "$PROGRAM_SO"

echo ""
echo "Deployment complete!"
