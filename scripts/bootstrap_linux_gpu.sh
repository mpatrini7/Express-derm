#!/usr/bin/env bash
set -euo pipefail

sudo apt update
sudo apt install -y \
  python3-venv \
  python3-pip \
  v4l-utils \
  ffmpeg \
  libgl1 \
  libglib2.0-0 \
  nodejs \
  npm

echo "Linux application prerequisites installed."
echo "Vendor desktop packages are not required for the UVC/V4L2 workflow."
