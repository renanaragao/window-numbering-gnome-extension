#!/bin/sh
#shellcheck source=/dev/null

EXT_NAME="window-numbering@local"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_NAME"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# Evita remover a própria pasta caso o script rode de um local inesperado
if [ "$EXT_DIR" = "$REPO_DIR" ]; then
  echo "Erro: O repositório está na mesma pasta de destino do GNOME!"
  exit 1
fi

# Cria a pasta base do GNOME Shell caso não exista
mkdir -p "$HOME/.local/share/gnome-shell/extensions"

# Remove link ou diretório antigo no destino
rm -rf "$EXT_DIR"

# Cria o link simbólico apontando para a pasta atual
ln -s "$REPO_DIR" "$EXT_DIR"

# Força o GNOME Shell a reindexar a pasta de extensões
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s "Main.extensionManager.scanExtensions()" >/dev/null 2>&1

# Desabilita e habilita para forçar a carga do código
gnome-extensions disable "$EXT_NAME" >/dev/null 2>&1
gnome-extensions enable "$EXT_NAME"
