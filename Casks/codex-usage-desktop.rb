cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "7.3.0"
  sha256 arm:   "2229beecca7b46caff6c672626ccf59c09a134770575ad774828707fb9a97e23",
         intel: "76205ff71ed32e10f5d605ae4b160b10e18d49cdfc7aae7ceefca0b419d0a03b"

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
