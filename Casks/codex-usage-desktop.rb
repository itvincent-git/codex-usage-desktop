cask "codex-usage-desktop" do
  arch arm: "arm64", intel: "x64"

  version "7.0.0"
  sha256 arm:   "4f7eb5245f75142fd5fa106c7c8d59c3dfdae20dd3d024d289818de1cb2d3496",
         intel: "b1382fafae45027330d065ab027617c1a60706fc08d9c4991d3b716bfd23b89d"

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
