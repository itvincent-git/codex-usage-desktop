cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "7.1.0"
  sha256 arm:   "7ee89b16851d6b6f92e6309cee8edb48c594f0262504ec12bbd146211b021893",
         intel: "c1d796d0607411b7aa1ffd13a179e8cbafe8f8b3308732438fc58cf6b3ebb683"

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
