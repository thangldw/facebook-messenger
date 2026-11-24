# Homebrew cask for Thrum. Install with:
#   brew tap thangldw/thrum https://github.com/thangldw/thrum
#   brew install --cask thangldw/thrum/thrum
# (Homebrew 6+ only loads casks from third-party taps that you trust; installing
# by the fully qualified name trusts this cask.)
# version and sha256 are updated by the release workflow (scripts/packaging.js).
cask "thrum" do
  arch arm: "arm64", intel: "x64"

  version "0.3.1"
  sha256 arm:   "67325358346e89993789af26c8abe082d0efa1ff20681357402bf8b18a307020",
         intel: "85159a4f02de3024d4405114cf6dac20567679d122d458abe9f7121e852f7105"

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
