#!/usr/bin/env bash
set -e
echo "=== Stress Benchmark Setup ==="

# Detect package manager
if command -v apt-get &>/dev/null; then
  PM="apt-get"
  sudo apt-get update -qq
  sudo apt-get install -y -qq build-essential bc python3 python3-pip python3-venv curl
elif command -v dnf &>/dev/null; then
  PM="dnf"
  sudo dnf install -y gcc gcc-c++ make bc python3 python3-pip curl
elif command -v pacman &>/dev/null; then
  PM="pacman"
  sudo pacman -Sy --noconfirm base-devel bc python python-pip curl
elif command -v brew &>/dev/null; then
  PM="brew"
  brew install bc python3 curl
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
  if [ "$PM" = "apt-get" ]; then sudo apt-get install -y -qq iperf3; fi
  if [ "$PM" = "dnf" ]; then sudo dnf install -y iperf3; fi
  if [ "$PM" = "pacman" ]; then sudo pacman -S --noconfirm iperf3; fi
fi

echo "=== Setup complete ==="
