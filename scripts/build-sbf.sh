#!/bin/bash
# Build script for Solana BPF programs
#
# This script sets up the correct environment for building Solana programs
# using cargo-build-sbf with the platform-tools.

set -e

# Solana installation paths
SOLANA_BIN="/pkg/main/net-p2p.agave.core/bin"
RUST_BIN="/pkg/main/dev-lang.rust.core.1.86.0/bin"
SBF_SDK="$HOME/.cache/solana-sbf-sdk"

# Platform tools rustc (has sbpf-solana-solana target)
PLATFORM_TOOLS_RUST="$HOME/.cache/solana/v1.52/platform-tools/rust/bin"

# Set up PATH with platform-tools rustc first (required for sbpf target)
export PATH="$PLATFORM_TOOLS_RUST:$SOLANA_BIN:$RUST_BIN:$PATH"

# Install platform tools if not already present
if [ ! -d "$HOME/.cache/solana/v1.52/platform-tools" ]; then
    echo "Installing Solana platform-tools..."
    mkdir -p "$SBF_SDK/dependencies"
    cargo build-sbf --install-only --no-rustup-override --sbf-sdk "$SBF_SDK"
fi

# Default to building all programs in the workspace
if [ $# -eq 0 ]; then
    echo "Building all Solana programs..."
    cargo build-sbf --no-rustup-override --sbf-sdk "$SBF_SDK" --workspace "$@"
else
    echo "Building with args: $@"
    cargo build-sbf --no-rustup-override --sbf-sdk "$SBF_SDK" "$@"
fi
