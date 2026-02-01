#!/usr/bin/env bash
set -e
echo "=== Stress Benchmark Setup ==="

# Pick sudo only when needed.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

# Detect package manager
if command -v apt-get &>/dev/null; then
  PM="apt-get"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq build-essential bc python3 python3-pip python3-venv curl pkg-config libssl-dev sshpass
elif command -v dnf &>/dev/null; then
  PM="dnf"
  $SUDO dnf install -y gcc gcc-c++ make bc python3 python3-pip curl pkgconf-pkg-config openssl-devel sshpass
elif command -v pacman &>/dev/null; then
  PM="pacman"
  $SUDO pacman -Sy --noconfirm base-devel bc python python-pip curl pkgconf openssl sshpass
elif command -v brew &>/dev/null; then
  PM="brew"
  brew install bc python3 curl pkg-config openssl sshpass
fi

# Install Rust if not present
if ! command -v rustc &>/dev/null; then
  echo "Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
fi
source "$HOME/.cargo/env" 2>/dev/null || true

# Python packages (in venv if possible)
echo "Installing Python packages..."
python3 -m pip install --user --quiet pandas numpy scikit-learn aiohttp 2>/dev/null || \
  python3 -m pip install --quiet --break-system-packages pandas numpy scikit-learn aiohttp 2>/dev/null || \
  echo "Warning: Could not install Python packages. Some benchmarks may fail."

# iperf3 for network benchmarks
if ! command -v iperf3 &>/dev/null; then
  if [ "$PM" = "apt-get" ]; then $SUDO apt-get install -y -qq iperf3; fi
  if [ "$PM" = "dnf" ]; then $SUDO dnf install -y iperf3; fi
  if [ "$PM" = "pacman" ]; then $SUDO pacman -S --noconfirm iperf3; fi
fi

echo "=== Setup complete ==="
