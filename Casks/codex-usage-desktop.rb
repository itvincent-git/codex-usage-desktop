cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.5.0"
  sha256 arm:   "0d51eeba332d37a3bcbf1a7d45fcaeed57b39c514f8a0ef65094276ac5da07f9",
         intel: "e3397587cdff85cd988bfd6e4c638813e4cfa38aac8c504aaabcd1755ed1c1ec"

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
