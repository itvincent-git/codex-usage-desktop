cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.13.2"
  sha256 arm:   "e46392592764d54e2ba1e0a5dfbb428d5239cea387a33f8dc7ee3a075802a1fe",
         intel: "11de6abc481db8e1d9dba901f4db0b9aca0c235d2a352dd55ead8178d49993bc"

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
