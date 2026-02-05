#!/bin/bash
# Deploy a Solana program to the test validator
#
# Usage: ./deploy-program.sh <program.so>

set -e

SOLANA_CLI="/pkg/main/net-p2p.agave.core/bin/solana"

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
