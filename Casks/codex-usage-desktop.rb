cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.6.0"
  sha256 arm:   "c391b707d80c14067cde4236642e72c5ca96197e39c1a424feadbe5677aca664",
         intel: "54d4bae0e3f2d3cb507ddabc64d27207d3d389fbe96a8b6295ce1f67fbb9c2a5"

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
