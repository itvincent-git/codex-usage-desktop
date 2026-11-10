cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "6.1.4"
  sha256 arm:   "3df201e9bc3df5e0cedec794cd6b031a5de7d906a69ad752872f6a653c10d0ba",
         intel: "014403c6929a3892627cd1b53bff1484faa5a79dc3b6f22bc69a81264dd89791"

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
