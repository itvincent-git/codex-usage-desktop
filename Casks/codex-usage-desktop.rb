cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.14.2"
  sha256 arm:   "a5c8235d7be520adf2c6eeeb897128e7f0533e3fb633d124bc146cbdcfebc17c",
         intel: "260ec20a8402dfd615c1cf657801272fbb0a11b077f82f456afed6b79fa8283c"

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
