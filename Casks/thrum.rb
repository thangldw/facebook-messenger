# Homebrew cask for Thrum. Install with:
#   brew tap thangldw/thrum https://github.com/thangldw/thrum
#   brew install --cask thangldw/thrum/thrum
# (Homebrew 6+ only loads casks from third-party taps that you trust; installing
# by the fully qualified name trusts this cask.)
# version and sha256 are updated by the release workflow (scripts/packaging.js).
cask "thrum" do
  arch arm: "arm64", intel: "x64"

  version "0.4.1"
  sha256 arm:   "aa9b957715569e007ae70a1582aa458827e7032acb241090e8e7eb9a1093a393",
         intel: "a551be1f6f4c6c42281aa7ae2ff96e59c6f60a3fe8375ab10669134de5d831c0"

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
