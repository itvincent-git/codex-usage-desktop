cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.1.3"
  sha256 arm:   "c1b2255015bc1646c55638e3357d82f5efb51e4977d54d6d062fe4b95cbf834b",
         intel: "2e30e5a2c17fce3c35c7305ce129e9225ef37942757ed21308cd7c7055c2eeb6"

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
