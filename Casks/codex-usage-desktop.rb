cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.4.2"
  sha256 arm:   "84d48007fae8b1f73d14be351533608dddc53a2775ec985cb8f01c956b96e8ab",
         intel: "29efc99d04ac95c20acc96dca0760dfb529155930a68447d117d3e25a23bf9d5"

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
