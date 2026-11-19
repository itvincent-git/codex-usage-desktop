cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.4.0"
  sha256 arm:   "8b726ced96bc4de09faea2bdbda899bb319103027cfded55b0a21d6fcc5dcd68",
         intel: "5566365e23090744f18b5d423dd69a16b482c25a67190b07be0a2e25e79dc3be"

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
