#!/bin/sh
set -eu

APP_NAME="Codex Usage Desktop"
APP_BUNDLE="${APP_NAME}.app"
REPO="itvincent-git/codex-usage-desktop"
INSTALL_DIR="/Applications"
MOUNT_POINT=""
TMP_DIR="$(mktemp -d)"

cleanup() {
  if [ -n "${MOUNT_POINT}" ] && mount | grep -q "on ${MOUNT_POINT} "; then
    hdiutil detach "${MOUNT_POINT}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TMP_DIR}"
}

trap cleanup EXIT INT TERM

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Codex Usage Desktop installer currently supports macOS only." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64)
    ASSET="codex-usage-desktop-macos-arm64.dmg"
    ;;
  x86_64)
    ASSET="codex-usage-desktop-macos-x64.dmg"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download Codex Usage Desktop." >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
DMG_PATH="${TMP_DIR}/${ASSET}"
MOUNT_POINT="${TMP_DIR}/mount"

mkdir -p "${MOUNT_POINT}"

echo "Downloading ${APP_NAME} for $(uname -m)..."
curl -fL --progress-bar "${URL}" -o "${DMG_PATH}"

echo "Mounting disk image..."
hdiutil attach "${DMG_PATH}" -mountpoint "${MOUNT_POINT}" -nobrowse -quiet

if [ ! -d "${MOUNT_POINT}/${APP_BUNDLE}" ]; then
  echo "Could not find ${APP_BUNDLE} in the downloaded disk image." >&2
  exit 1
fi

echo "Installing to ${INSTALL_DIR}..."
if [ -w "${INSTALL_DIR}" ]; then
  if [ -d "${INSTALL_DIR}/${APP_BUNDLE}" ]; then
    rm -rf "${INSTALL_DIR:?}/${APP_BUNDLE}"
  fi
  cp -R "${MOUNT_POINT}/${APP_BUNDLE}" "${INSTALL_DIR}/"
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to install to ${INSTALL_DIR}." >&2
    exit 1
  fi
  if [ -d "${INSTALL_DIR}/${APP_BUNDLE}" ]; then
    sudo rm -rf "${INSTALL_DIR:?}/${APP_BUNDLE}"
  fi
  sudo cp -R "${MOUNT_POINT}/${APP_BUNDLE}" "${INSTALL_DIR}/"
fi

echo
echo "${APP_NAME} has been installed to ${INSTALL_DIR}/${APP_BUNDLE}."
echo "If macOS blocks the first launch, open System Settings > Privacy & Security and allow the app."
