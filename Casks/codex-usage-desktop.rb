cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "5.3.2"
  sha256 arm:   "6e9337eb3a5e7b9126bc4a58b8de34818c2fecb8ebf6b17da4d866af8530d7cf",
         intel: "2fb27361d4d33d8917fdfe4742f0b7e0689f300c493d0d3b587cd1055c4ed88e"

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
