# Homebrew cask for Messenger Lite. Install with:
#   brew tap thangldw/messenger-lite https://github.com/thangldw/facebook-messenger
#   brew install --cask messenger-lite
# version and sha256 are updated by the release workflow (scripts/packaging.js).
cask "messenger-lite" do
  arch arm: "arm64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "7986e5dbb8c15c4f4eb149c5d943e4b28eb38207b52999cab00f91ebca626bef",
         intel: "b0fae1c92ddacbee75b6d2bdd6e00bd44932074ea62b87d1f272bcee7fd41610"

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
