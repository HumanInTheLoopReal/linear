# typed: false
# frozen_string_literal: true

#
# Template Homebrew formula for the Linear CLI (HumanInTheLoopReal/linear).
#
# This file is NOT loaded by Homebrew directly. It lives here so the
# formula contents are auditable inside the linear-cli repo. At release
# time it gets copied to the external tap repo at:
#
#   github.com/HumanInTheLoopReal/homebrew-linear : Formula/linear.rb
#
# Tap consumers then run:
#
#   brew tap HumanInTheLoopReal/linear
#   brew install linear
#
# Maintenance flow (see docs/homebrew/README.md for the full runbook):
#
#   1. `npm publish` lands a new @humanintheloop/linear@X.Y.Z on the npm
#      registry.
#   2. Fetch the new tarball's sha256:
#        curl -fsSL https://registry.npmjs.org/@humanintheloop/linear/-/linear-X.Y.Z.tgz \
#          | shasum -a 256
#      (`npm view @humanintheloop/linear@X.Y.Z dist.shasum` reports sha1,
#      which Homebrew rejects.)
#   3. Open a PR against HumanInTheLoopReal/homebrew-linear updating `url` +
#      `sha256` (and `revision` if rebuilt without bumping linear).
#
class Linear < Formula
  desc "Agent-first CLI for Linear.app"
  homepage "https://github.com/HumanInTheLoopReal/linear"
  # URL + sha256 below are placeholders. Update these in the tap repo for
  # each release. The npm registry tarball layout is stable, and for a
  # scoped package the scope appears in the path but not the filename:
  #   https://registry.npmjs.org/@scope/<name>/-/<name>-<version>.tgz
  url "https://registry.npmjs.org/@humanintheloop/linear/-/linear-X.Y.Z.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/linear --version")
  end
end
