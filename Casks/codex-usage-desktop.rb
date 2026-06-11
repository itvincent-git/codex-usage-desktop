cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-#{arch}.dmg"
  name "Codex Usage Desktop"
  desc "Local-first macOS dashboard for Codex CLI token usage and cost estimates"
  homepage "https://github.com/itvincent-git/codex-usage-desktop"

  app "Codex Usage Desktop.app"

  zap trash: [
    "~/Library/Application Support/com.ccusage.codex.desktop",
    "~/Library/Caches/com.ccusage.codex.desktop",
    "~/Library/Logs/com.ccusage.codex.desktop",
    "~/Library/Preferences/com.ccusage.codex.desktop.plist",
    "~/Library/Saved Application State/com.ccusage.codex.desktop.savedState",
  ]
end
