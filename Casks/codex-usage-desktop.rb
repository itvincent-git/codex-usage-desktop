cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.2.1"
  sha256 arm:   "2c185e9c2106bf494bd4207a097463fdc853fbf3339f87dcfc9ba0a2947d48b1",
         intel: "f0f26984f60ab4024ec430c67a725030559665a1d422163db3ebc6b5f496d75b"

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
