cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.2.1"
  sha256 arm:   "eab8b8b8de27a1595f4c8e19b0128fdd8d1c0429213d4eb263a5a6b2d45f4118",
         intel: "6d3bf27664c30b6cfda954d5f51c23ee6db4a4f180db45cf16f04f842a92d15d"

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
