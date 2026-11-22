#!/bin/sh
# Builds target/FirefliesMVP.app for the iOS Simulator (Apple Silicon).
set -eu
cd "$(dirname "$0")"
[ -e .rust ] || nix build --impure --expr 'import ./toolchain.nix' -o .rust
PATH="$PWD/.rust/bin:$PATH" cargo build --target aarch64-apple-ios-sim
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
APP=target/FirefliesMVP.app
rm -rf "$APP" && mkdir -p "$APP"
cp host/Info.plist "$APP/"
xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -sdk "$SDK" \
  -import-objc-header host/bridge.h host/main.swift \
  -L target/aarch64-apple-ios-sim/debug -lfireflies_ios_mvp \
  -framework UIKit -framework Metal -framework QuartzCore -framework CoreText \
  -framework CoreGraphics -framework CoreVideo -framework CoreFoundation -framework IOSurface \
  -lc++ -Xlinker -dead_strip -o "$APP/FirefliesMVP"
codesign -s - "$APP"
echo "$APP"
