import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

const VERSION =
  "v2.2.1 - Reserved Keys Protected & Selection Cleanup";

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
    this._reservedWindowsMap = new Map();
    this._reservedKeysInUse = new Set();

    this._shownId = Main.overview.connect("shown", () => this._drawLabels());
    this._hidingId = Main.overview.connect("hiding", () => this._clearLabels());
    this._workspaceSwitchedId = global.workspace_manager.connect(
      "active-workspace-changed",
      () => {
        if (Main.overview.visible) this._drawLabels();
      },
    );

    const searchEntry = Main.overview.searchEntry;
    if (searchEntry) {
      this._searchId = searchEntry.clutter_text.connect("text-changed", () => {
        this._onSearchChanged();
      });
    }

    this._refreshReservedWindowsMap();
    this._setupKeyHandler();
  }

  disable() {
    console.log(`[Window-Numbering] Desativando ${VERSION}`);
    if (this._shownId) Main.overview.disconnect(this._shownId);
    if (this._hidingId) Main.overview.disconnect(this._hidingId);
    if (this._workspaceSwitchedId)
      global.workspace_manager.disconnect(this._workspaceSwitchedId);

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

    const eligibleWindows = this._collectVisibleWindowsForOverview();
    const {
      reservedWindowToKey,
      reservedKeysInUse,
      reservedKeyToWindow,
    } = this._buildReservedWindowAssignments(rules, eligibleWindows);

    this._reservedKeysInUse = reservedKeysInUse;
    this._reservedWindowsMap = reservedKeyToWindow;
    reservedKeyToWindow.forEach((win, key) => {
      this._windowsMap.set(key, win);
    });

    const allPreviews = this._findPreviews(Main.layoutManager.overviewGroup);

    // PASSO 2: Define o pool de chaves livres (exclui as reservadas)
    const availableKeys = ALL_KEYS.filter((k) => !reservedKeysInUse.has(k));
    let freeKeyIndex = 0;

    // PASSO 3: Atribui as chaves restantes sequencialmente e desenha as badges
    allPreviews.forEach((preview) => {
      const metaWin = preview.metaWindow || preview._metaWindow;
      if (!metaWin || !eligibleWindows.has(metaWin)) return;
      if (!this._isPreviewVisuallyPresent(preview)) return;

      let keyChar = reservedWindowToKey.get(metaWin);

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
  }

  _isPreviewVisuallyPresent(preview) {
    if (!preview) return false;

    if (
      typeof preview.get_paint_visibility === "function" &&
      !preview.get_paint_visibility()
    )
      return false;
    if (typeof preview.get_mapped === "function" && !preview.get_mapped())
      return false;
    if (typeof preview.is_visible === "function" && !preview.is_visible())
      return false;
    if (
      typeof preview.get_paint_opacity === "function" &&
      preview.get_paint_opacity() === 0
    )
      return false;

    if (typeof preview.get_transformed_size === "function") {
      const [width, height] = preview.get_transformed_size();
      if (width <= 0 || height <= 0) return false;
    }

    return true;
  }

  _refreshReservedWindowsMap() {
    const config = this._loadConfig();
    const rules = config.reserved_rules || [];
    const eligibleWindows = this._collectEligibleWindows();
    const { reservedKeyToWindow, reservedKeysInUse } =
      this._buildReservedWindowAssignments(rules, eligibleWindows);

    this._reservedWindowsMap = reservedKeyToWindow;
    this._reservedKeysInUse = reservedKeysInUse;
  }

  _collectVisibleWindowsForOverview() {
    const activeWorkspace = global.workspace_manager.get_active_workspace();
    if (!activeWorkspace) return new Set();

    const windows = new Set();
    activeWorkspace.list_windows().forEach((win) => {
      if (!win || win.is_skip_taskbar()) return;
      windows.add(win);
    });

    return windows;
  }

  _collectEligibleWindows() {
    const workspaceManager = global.workspace_manager;
    const windows = new Set();

    for (let i = 0; i < workspaceManager.n_workspaces; i++) {
      const workspace = workspaceManager.get_workspace_by_index(i);
      if (!workspace) continue;

      const workspaceWindows = workspace.list_windows();
      workspaceWindows.forEach((win) => {
        if (!win || win.is_skip_taskbar()) return;
        if (
          typeof win.showing_on_its_workspace === "function" &&
          !win.showing_on_its_workspace()
        )
          return;
        windows.add(win);
      });
    }

    return windows;
  }

  _buildReservedWindowAssignments(rules, eligibleWindows) {
    const windows = Array.from(eligibleWindows);
    const reservedKeyToWindow = new Map();
    const reservedWindowToKey = new Map();
    const reservedKeysInUse = new Set();
    const mruRanks = this._getMruRanks();

    for (const rule of rules) {
      const matchTerm = (rule.match || "").toLowerCase().trim();
      const targetKey = (rule.key || "").toUpperCase().trim();

      if (!matchTerm || !ALL_KEYS.includes(targetKey)) continue;
      reservedKeysInUse.add(targetKey);
      if (reservedKeyToWindow.has(targetKey)) continue;

      const matchingWindows = windows.filter((win) => {
        const title = (win.get_title() || "").toLowerCase();
        const wmClass = (win.get_wm_class() || "").toLowerCase();
        return title.includes(matchTerm) || wmClass.includes(matchTerm);
      });

      const selectedWindow = this._selectMostRecentWindow(
        matchingWindows,
        mruRanks,
      );
      if (!selectedWindow) continue;

      reservedKeyToWindow.set(targetKey, selectedWindow);
      reservedWindowToKey.set(selectedWindow, targetKey);
      reservedKeysInUse.add(targetKey);
    }

    return { reservedKeyToWindow, reservedWindowToKey, reservedKeysInUse };
  }

  _getMruRanks() {
    const mruWindows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
    const ranks = new Map();
    for (let i = 0; i < mruWindows.length; i++) {
      ranks.set(mruWindows[i], i);
    }
    return ranks;
  }

  _selectMostRecentWindow(windows, ranks) {
    if (windows.length === 0) return null;

    let selected = windows[0];
    let bestRank = Number.POSITIVE_INFINITY;

    windows.forEach((win) => {
      const rank = ranks.has(win) ? ranks.get(win) : Number.POSITIVE_INFINITY;
      if (rank < bestRank) {
        bestRank = rank;
        selected = win;
      }
    });

    return selected;
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
      const isOverviewVisible = Main.overview.visible;

      // Exige obrigatoriamente o pressionamento do Shift
      const state = event.get_state();
      const hasShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
      if (!hasShift) return Clutter.EVENT_PROPAGATE;

      // Se houver texto na busca da overview, ignora os atalhos
      if (isOverviewVisible) {
        const searchText = Main.overview.searchEntry.get_text().trim();
        if (searchText.length > 0) return Clutter.EVENT_PROPAGATE;
      }

      this._refreshReservedWindowsMap();

      // Lê o caractere da tecla
      const symbol = event.get_key_symbol();
      const keyName = Clutter.keyval_name(symbol).toUpperCase();
      if (!ALL_KEYS.includes(keyName)) return Clutter.EVENT_PROPAGATE;

      let win = null;
      if (isOverviewVisible) {
        win = this._windowsMap.get(keyName) || this._reservedWindowsMap.get(keyName);
      } else {
        win = this._reservedWindowsMap.get(keyName);
      }

      if (win) {
        if (isOverviewVisible) Main.overview.hide();
        win.activate(global.get_current_time());
        this._clearLabels();
        return Clutter.EVENT_STOP;
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
    this._labels.forEach((l) => l.destroy());
    this._labels = [];
    this._windowsMap.clear();
  }
}
