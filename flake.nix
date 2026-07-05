{
  description = "OpenStroid";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-electron.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs = {
    self,
    nixpkgs,
    nixpkgs-electron,
  }: let
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    pkgsFor = system: import nixpkgs {inherit system;};
    electronPkgsFor = system:
      import nixpkgs-electron {
        inherit system;
        config.permittedInsecurePackages = ["electron-37.10.3"];
      };
    linuxElectronConfig = pkgs: electronPackage: {
      packages = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [electronPackage];
      env = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
        export ELECTRON_SKIP_BINARY_DOWNLOAD=1
        export ELECTRON_OVERRIDE_DIST_PATH="${electronPackage}/bin"
        export npm_config_electron_skip_binary_download=true
      '';
    };
  in {
    devShells = forAllSystems (system: let
      pkgs = pkgsFor system;
      linuxElectron = linuxElectronConfig pkgs (electronPkgsFor system).electron_37;
    in {
      default = pkgs.mkShell {
        packages = with pkgs;
          [
            bun
            nodejs_22
            pkg-config
            python3
          ]
          ++ linuxElectron.packages
          ++ lib.optionals stdenv.hostPlatform.isLinux [
            fakeroot
            rpm
            ruby
          ];

        shellHook =
          ''
            export ELECTRON_CACHE="$PWD/.cache/electron"
            export ELECTRON_BUILDER_CACHE="$PWD/.cache/electron-builder"
          ''
          + linuxElectron.env;
      };
    });

    apps = forAllSystems (system: let
      pkgs = pkgsFor system;
      linuxElectron = linuxElectronConfig pkgs (electronPkgsFor system).electron_37;
      openstroidDev = pkgs.writeShellApplication {
        name = "openstroid-dev";
        runtimeInputs =
          [
            pkgs.bun
            pkgs.nodejs_22
          ]
          ++ linuxElectron.packages;
        text =
          linuxElectron.env
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
