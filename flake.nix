{
  description = "OpenStroid";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    pkgsFor = system: import nixpkgs {inherit system;};
  in {
    devShells = forAllSystems (system: let
      pkgs = pkgsFor system;
    in {
      default = pkgs.mkShell {
        packages = with pkgs;
          [
            bun
            nodejs_22
            pkg-config
            python3
          ]
          ++ lib.optionals stdenv.hostPlatform.isLinux [
            electron
            fakeroot
            rpm
            ruby
          ];

        shellHook =
          ''
            export ELECTRON_CACHE="$PWD/.cache/electron"
            export ELECTRON_BUILDER_CACHE="$PWD/.cache/electron-builder"
          ''
          + pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
            export ELECTRON_SKIP_BINARY_DOWNLOAD=1
            export ELECTRON_OVERRIDE_DIST_PATH="${pkgs.electron}/bin"
            export npm_config_electron_skip_binary_download=true
          '';
      };
    });

    apps = forAllSystems (system: let
      pkgs = pkgsFor system;
      openstroidDev = pkgs.writeShellApplication {
        name = "openstroid-dev";
        runtimeInputs =
          [
            pkgs.bun
            pkgs.nodejs_22
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [pkgs.electron];
        text =
          pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
            export ELECTRON_SKIP_BINARY_DOWNLOAD=1
            export ELECTRON_OVERRIDE_DIST_PATH="${pkgs.electron}/bin"
            export npm_config_electron_skip_binary_download=true
          ''
          + ''
            exec bun run dev "$@"
          '';
      };
    in {
      default = {
        type = "app";
        program = "${openstroidDev}/bin/openstroid-dev";
      };
    });

    formatter = forAllSystems (system: let
      pkgs = pkgsFor system;
    in
      pkgs.writeShellApplication {
        name = "openstroid-fmt";
        runtimeInputs = [pkgs.alejandra];
        text = ''
          if [ "$#" -eq 0 ]; then
            set -- flake.nix
          fi

          exec alejandra "$@"
        '';
      });
  };
}
