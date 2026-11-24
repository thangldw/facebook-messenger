# Homebrew cask for Thrum. Install with:
#   brew tap thangldw/thrum https://github.com/thangldw/thrum
#   brew install --cask thangldw/thrum/thrum
# (Homebrew 6+ only loads casks from third-party taps that you trust; installing
# by the fully qualified name trusts this cask.)
# version and sha256 are updated by the release workflow (scripts/packaging.js).
cask "thrum" do
  arch arm: "arm64", intel: "x64"

  version "0.2.0"
  sha256 arm:   "05e1fedbdc579acd3992b81c7f307a2db152d119ee4f880ecebe6ed43ac57bf9",
         intel: "4b650cada413e87db7ac37dc001648c2a5f060aad802207584e86114a023b271"

  url "https://github.com/thangldw/thrum/releases/download/v#{version}/Thrum-#{version}-mac-#{arch}.zip"
  name "Thrum"
  desc "Desktop app for Facebook Messenger with the News Feed blocked"
  homepage "https://github.com/thangldw/thrum"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Thrum.app"

  # The app is ad-hoc signed, not notarized, so Gatekeeper would refuse to open
  # it. Homebrew has already verified the download against sha256 above.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Thrum.app"]
  end

  zap trash: [
    "~/Library/Application Support/Thrum",
    "~/Library/Preferences/io.github.thangldw.thrum.plist",
    "~/Library/Saved Application State/io.github.thangldw.thrum.savedState",
  ]
end
