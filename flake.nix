{
  # A development shell for this repository: the language servers its code
  # needs, so editors (Fireflies' own through direnv, see .envrc) work on it
  # without anything installed globally. Language tooling only: the build's
  # toolchain (cargo from the system, Zig 0.16 by path) stays as it is.
  #
  # nix-darwin takes this repository with `flake = false`: this file doesn't
  # change how the app is built there.
  description = "Fireflies development shell: language servers";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      each = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = each (pkgs: {
        default = pkgs.mkShellNoCC {
          packages = [
            # Rust: rust-analyzer with the cargo and rustc it reads the
            # workspace through, and the standard library's sources.
            pkgs.rust-analyzer
            pkgs.cargo
            pkgs.rustc
            pkgs.rustfmt
            pkgs.clippy
            # The mods (JavaScript) and scripts (TypeScript).
            pkgs.typescript-language-server
            pkgs.typescript
            # flake.nix and the TOML files.
            pkgs.nixd
            pkgs.taplo
          ];
          RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
        };
      });
    };
}
