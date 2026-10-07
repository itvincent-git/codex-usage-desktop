cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "3.13.1"
  sha256 arm:   "acbe130f8abfd38b8ca9c77922293afc798471036d42d600ab8243640417010d",
         intel: "074e1be69602e3f08bbdaec0e3b367a5a1dc063fff8549401a0cae4b05fd905d"

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
