cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.12.0"
  sha256 arm:   "4c39ca39908a0c1c0771940fc42344a430975baa89746225e7a4fbbd94d20e64",
         intel: "4b9997976a4f6305c9f4d6b198db166dc1aaf2b1574683b68a51530c55a6d667"

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
