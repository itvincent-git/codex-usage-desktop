cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.3.1"
  sha256 arm:   "72a7b50a33a07d6e313d54e9469fcd841df25e0eb702a7e2b00e8e5c3c8d4b5d",
         intel: "7962647d153f733a2245c15a2faba32de7a7befb582c7fde8838cf2721d326dd"

  url "https://github.com/itvincent-git/codex-usage-desktop/releases/download/app-v#{version}/codex-usage-desktop-macos-#{arch}.dmg"
  name "Codex Usage Desktop"
  desc "Local-first dashboard for Codex CLI token usage and cost estimates"
  homepage "https://github.com/itvincent-git/codex-usage-desktop"

  depends_on :macos

  app "Codex Usage Desktop.app"

  zap trash: [
    "~/Library/Application Support/com.ccusage.codex.desktop",
    "~/Library/Caches/com.ccusage.codex.desktop",
    "~/Library/Logs/com.ccusage.codex.desktop",
    "~/Library/Preferences/com.ccusage.codex.desktop.plist",
    "~/Library/Saved Application State/com.ccusage.codex.desktop.savedState",
  ]
end
