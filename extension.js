import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

const VERSION = "v2.0.0 - JSON Mappings & Shift Activation";

const ALL_KEYS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
];

export default class WindowNumberingExtension extends Extension {
  enable() {
    console.log(`[Window-Numbering] Ativando ${VERSION}`);
    this._labels = [];
    this._windowsMap = new Map();

    this._shownId = Main.overview.connect("shown", () => this._drawLabels());
    this._hidingId = Main.overview.connect("hiding", () => this._clearLabels());

    const searchEntry = Main.overview.searchEntry;
    if (searchEntry) {
      this._searchId = searchEntry.clutter_text.connect("text-changed", () => {
        this._onSearchChanged();
      });
    }
  }

  disable() {
    console.log(`[Window-Numbering] Desativando ${VERSION}`);
    if (this._shownId) Main.overview.disconnect(this._shownId);
    if (this._hidingId) Main.overview.disconnect(this._hidingId);

    const searchEntry = Main.overview.searchEntry;
    if (this._searchId && searchEntry) {
      searchEntry.clutter_text.disconnect(this._searchId);
    }

    this._clearLabels();
    this._removeKeyHandler();
  }

  // Carrega e faz o parse do config.json em tempo de execução
  _loadConfig() {
    try {
      const configPath = GLib.build_filenamev([this.path, "config.json"]);
      const file = Gio.File.new_for_path(configPath);

      if (!file.query_exists(null)) {
        return { reserved_rules: [] };
      }

      const [success, contents] = file.load_contents(null);
      if (success) {
        const jsonString = new TextDecoder().decode(contents);
        return JSON.parse(jsonString);
      }
    } catch (e) {
      console.log(
        `[Window-Numbering] Erro ao carregar config.json: ${e.message}`,
      );
    }
    return { reserved_rules: [] };
  }

  _onSearchChanged() {
    const searchText = Main.overview.searchEntry.get_text().trim();
    const isSearching = searchText.length > 0;

    this._labels.forEach((label) => {
      label.visible = !isSearching;
    });
  }

  _drawLabels() {
    this._clearLabels();
    this._windowsMap.clear();

    const config = this._loadConfig();
    const rules = config.reserved_rules || [];

    const activeWorkspace = global.workspace_manager.get_active_workspace();
    const validWindows = activeWorkspace
      .list_windows()
      .filter((w) => w.showing_on_its_workspace() && !w.is_skip_taskbar());

    const allPreviews = this._findPreviews(Main.layoutManager.overviewGroup);

    // Conjunto de chaves reservadas usadas na sessão
    const reservedKeysInUse = new Set();
    const assignedMap = new Map(); // preview -> keyChar

    // PASSO 1: Associa regras do config.json às janelas correspondentes
    allPreviews.forEach((preview) => {
      const metaWin = preview.metaWindow || preview._metaWindow;
      if (!metaWin || !validWindows.includes(metaWin)) return;

      const title = (metaWin.get_title() || "").toLowerCase();
      const wmClass = (metaWin.get_wm_class() || "").toLowerCase();

      for (const rule of rules) {
        const matchTerm = (rule.match || "").toLowerCase();
        const targetKey = (rule.key || "").toUpperCase();

        if (
          matchTerm &&
          (title.includes(matchTerm) || wmClass.includes(matchTerm))
        ) {
          assignedMap.set(preview, targetKey);
          reservedKeysInUse.add(targetKey);
          break;
        }
      }
    });

    // PASSO 2: Define o pool de chaves livres (exclui as reservadas)
    const availableKeys = ALL_KEYS.filter((k) => !reservedKeysInUse.has(k));
    let freeKeyIndex = 0;

    // PASSO 3: Atribui as chaves restantes sequencialmente e desenha as badges
    allPreviews.forEach((preview) => {
      const metaWin = preview.metaWindow || preview._metaWindow;
      if (!metaWin || !validWindows.includes(metaWin)) return;
      if (typeof preview.get_mapped === "function" && !preview.get_mapped())
        return;

      let keyChar = assignedMap.get(preview);

      if (!keyChar) {
        if (freeKeyIndex >= availableKeys.length) return;
        keyChar = availableKeys[freeKeyIndex];
        freeKeyIndex++;
      }

      // Registra no mapa global (salva em maiúsculo para combinar com o Shift)
      this._windowsMap.set(keyChar.toUpperCase(), metaWin);

      const [x, y] = preview.get_transformed_position();

      const label = new St.Label({
        text: keyChar,
        style_class: "window-number-badge",
        style: `
          background-color: #3584e4;
          color: white;
          font-weight: bold;
          font-size: 18px;
          border-radius: 12px;
          padding: 5px 11px;
          border: 2px solid white;
          box-shadow: 0px 4px 8px rgba(0,0,0,0.6);
        `,
      });

      Main.uiGroup.add_child(label);
      label.set_position(x + 10, y + 10);
      this._labels.push(label);
    });

    this._onSearchChanged();
    this._setupKeyHandler();
  }

  _findPreviews(node) {
    let found = [];
    if (!node) return found;

    const metaWin = node.metaWindow || node._metaWindow;
    if (
      metaWin &&
      node.constructor &&
      node.constructor.name.includes("WindowPreview")
    ) {
      found.push(node);
    } else if (typeof node.get_children === "function") {
      const children = node.get_children();
      for (let i = 0; i < children.length; i++) {
        found = found.concat(this._findPreviews(children[i]));
      }
    }
    return found;
  }

  _setupKeyHandler() {
    this._removeKeyHandler();
    this._keyPressId = global.stage.connect("key-press-event", (_, event) => {
      if (!Main.overview.visible) return Clutter.EVENT_PROPAGATE;

      // Se houver texto na busca, ignora os atalhos
      const searchText = Main.overview.searchEntry.get_text().trim();
      if (searchText.length > 0) return Clutter.EVENT_PROPAGATE;

      // 1. Exige obrigatoriamente o pressionamento do Shift
      const state = event.get_state();
      const hasShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

      if (!hasShift) return Clutter.EVENT_PROPAGATE;

      // 2. Lê o caractere da tecla
      const symbol = event.get_key_symbol();
      const keyName = Clutter.keyval_name(symbol).toUpperCase();

      if (this._windowsMap.has(keyName)) {
        const win = this._windowsMap.get(keyName);
        if (win) {
          Main.overview.hide();
          win.activate(global.get_current_time());
          return Clutter.EVENT_STOP;
        }
      }
      return Clutter.EVENT_PROPAGATE;
    });
  }

  _removeKeyHandler() {
    if (this._keyPressId) {
      global.stage.disconnect(this._keyPressId);
      this._keyPressId = null;
    }
  }

  _clearLabels() {
    this._removeKeyHandler();
    this._labels.forEach((l) => l.destroy());
    this._labels = [];
  }
}
