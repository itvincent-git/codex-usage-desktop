cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.0.0"
  sha256 arm:   "83727fd3e09281fad45cf5969b3078469b28790ca9bdacf35a4454b1be4bead4",
         intel: "62f76a106f3c3df6622b105ec818f059cef4956a5be8a292d2354634ba84b4e2"

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
