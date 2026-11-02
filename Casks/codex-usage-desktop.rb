cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.4.3"
  sha256 arm:   "a50f7e601b9f1e678865c8d3ff82e5b1eeae21bc3ca639a0438317fc4dbfd573",
         intel: "48fa74733635b4a82571b636b54ef9d579552cffaf6e230c1ee8de45beb0ea7d"

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
