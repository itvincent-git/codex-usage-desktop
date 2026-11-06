cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.7.0"
  sha256 arm:   "ec5606572230b118cc99c6093b025a33de8bbb2cb79d411fcc32e15637018054",
         intel: "0267a310637049acf3b4fba7d6596c11b24bc2179b3fb1a8ddbeffb3ee334a05"

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
