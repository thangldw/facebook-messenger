# Homebrew cask for Messenger Lite. Install with:
#   brew tap thangldw/messenger-lite https://github.com/thangldw/facebook-messenger
#   brew install --cask thangldw/messenger-lite/messenger-lite
# (Homebrew 6+ only loads casks from third-party taps that you trust; installing
# by the fully qualified name trusts this cask.)
# version and sha256 are updated by the release workflow (scripts/packaging.js).
cask "messenger-lite" do
  arch arm: "arm64", intel: "x64"

  version "0.2.0"
  sha256 arm:   "05e1fedbdc579acd3992b81c7f307a2db152d119ee4f880ecebe6ed43ac57bf9",
         intel: "4b650cada413e87db7ac37dc001648c2a5f060aad802207584e86114a023b271"

  url "https://github.com/thangldw/facebook-messenger/releases/download/v#{version}/MessengerLite-#{version}-mac-#{arch}.zip"
  name "Messenger Lite"
  desc "Desktop app for Facebook Messenger with the News Feed blocked"
  homepage "https://github.com/thangldw/facebook-messenger"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Messenger Lite.app"

  # The app is ad-hoc signed, not notarized, so Gatekeeper would refuse to open
  # it. Homebrew has already verified the download against sha256 above.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Messenger Lite.app"]
  end

  zap trash: [
    "~/Library/Application Support/Messenger Lite",
    "~/Library/Preferences/local.personal.messenger-lite.plist",
    "~/Library/Saved Application State/local.personal.messenger-lite.savedState",
  ]
end
