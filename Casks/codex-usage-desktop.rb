cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.4.1"
  sha256 arm:   "eae0864d608b51c297d7eda3e8596e61f42c9502db143a002027f06d7dfd2e8f",
         intel: "04f1c67b5c3f65838730903b0ce9f147c52dfccf27221097d2bf24fe6c109131"

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
