cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.2.0"
  sha256 arm:   "c0e74836b40677e60a1ad1e02bdb545c44324a795fa80003381f073a2c8dbf8f",
         intel: "9179e7e45e2f214ca407e066627f9f136f6b64f06ea2f9dae921c76bbdaa1407"

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
