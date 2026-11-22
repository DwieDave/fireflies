# Rust 1.95 with the iOS Simulator and device std, for prototypes/ios-mvp only.
# nix build --impure --expr 'import ./prototypes/ios-mvp/toolchain.nix' -o prototypes/ios-mvp/.rust
let
  overlay = builtins.getFlake "github:oxalica/rust-overlay";
  pkgs = import overlay.inputs.nixpkgs { system = "aarch64-darwin"; overlays = [ overlay.overlays.default ]; };
in
pkgs.rust-bin.stable."1.95.0".minimal.override {
  targets = [ "aarch64-apple-darwin" "aarch64-apple-ios-sim" "aarch64-apple-ios" ];
}
