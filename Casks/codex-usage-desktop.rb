cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.0.2"
  sha256 arm:   "421cadc96139c3590fdaeaa9dd2c3f6836bba897f4abf16274d53a62df95e8c2",
         intel: "28dbab6fb98a16f9bb46bedb98f6516a792c71818a6cfcbc5e21111feb8fd779"

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
