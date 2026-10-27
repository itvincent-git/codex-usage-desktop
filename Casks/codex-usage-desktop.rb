cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.1.1"
  sha256 arm:   "9c6b363fd36db078e05d1e93c11d1b4d5ea4b5487677fe75085785e1688838db",
         intel: "e25d266d593b061f53bd26cc8e1bac310b2ba74530168cf1b9234d0ddb9bbd9d"

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
