cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.1.2"
  sha256 arm:   "b1a6db3fdac10575427fcd843234113728265203f5d6f3e8611543b77b2b2af2",
         intel: "e480a0536c7d95bc3a2b4bf41a1f5b0f4eb845a8df83201ef30043ca8d378282"

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
