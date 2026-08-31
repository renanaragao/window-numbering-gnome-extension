#!/bin/sh
#shellcheck source=/dev/null

EXT_NAME="window-numbering@local"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_NAME"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"

# Copia os arquivos necessários
cp "$REPO_DIR/extension.js" "$EXT_DIR/"
cp "$REPO_DIR/metadata.json" "$EXT_DIR/"
[ -f "$REPO_DIR/config.json" ] && cp "$REPO_DIR/config.json" "$EXT_DIR/"

# Reindexa e ativa
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s "Main.extensionManager.scanExtensions()" >/dev/null 2>&1

gnome-extensions disable "$EXT_NAME" >/dev/null 2>&1
gnome-extensions enable "$EXT_NAME"
