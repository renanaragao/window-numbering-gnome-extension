import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

const VERSION =
  "v2.4.1 - Fix MetaDisplay Signal Error & Safe Event Filtering";
const WORKSPACE_REDRAW_DELAY_MS = 300;

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
    this._freeKeyToWindow = new Map();
    this._freeWindowToKey = new Map();
    this._workspaceRedrawId = 0;
    this._workspaceRedrawAttempts = 0;
    this._searchEntry = null;
    this._searchId = 0;
    this._keyPressId = 0;

    this._shownId = Main.overview.connect("shown", () => {
      this._ensureSearchSignal();
      this._drawLabels();
    });
    this._hidingId = Main.overview.connect("hiding", () => this._clearLabels());
    this._workspaceSwitchedId = global.workspace_manager.connect(
      "active-workspace-changed",
      () => {
        if (Main.overview.visible) {
          this._clearLabels();
          this._scheduleWorkspaceRedraw();
        }
      },
    );

    this._ensureSearchSignal();
    this._refreshReservedWindowsMap();
    this._setupKeyHandler();
  }

  disable() {
    console.log(`[Window-Numbering] Desativando ${VERSION}`);
    if (this._shownId) Main.overview.disconnect(this._shownId);
    if (this._hidingId) Main.overview.disconnect(this._hidingId);
    if (this._workspaceSwitchedId)
      global.workspace_manager.disconnect(this._workspaceSwitchedId);

    this._disconnectSearchSignal();

    this._clearLabels();
    this._removeKeyHandler();
    this._freeKeyToWindow.clear();
    this._freeWindowToKey.clear();
    this._cancelWorkspaceRedraw();
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

  _ensureSearchSignal() {
    const searchEntry = Main.overview.searchEntry;
    if (!searchEntry) return;

    if (this._searchEntry === searchEntry && this._searchId) return;

    this._disconnectSearchSignal();
    this._searchEntry = searchEntry;
    this._searchId = searchEntry.clutter_text.connect("text-changed", () => {
      this._onSearchChanged();
    });
  }

  _disconnectSearchSignal() {
    if (
      this._searchEntry &&
      this._searchId &&
      this._searchEntry.clutter_text
    ) {
      this._searchEntry.clutter_text.disconnect(this._searchId);
    }

    this._searchEntry = null;
    this._searchId = 0;
  }

  _onSearchChanged() {
    const searchEntry = Main.overview.searchEntry;
    if (!searchEntry) return;

    const searchText = searchEntry.get_text().trim();
    const isSearching = searchText.length > 0;

    this._labels.forEach((label) => {
      label.visible = !isSearching;
    });
  }

  _drawLabels() {
    this._cancelWorkspaceRedraw();
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

    this._cleanupFreeAssignments(reservedKeysInUse);

    const allPreviews = this._findPreviews(Main.layoutManager.overviewGroup);

    // PASSO 2: Define o pool de chaves livres (exclui as reservadas)
    const availableKeys = ALL_KEYS.filter(
      (k) =>
        !reservedKeysInUse.has(k) &&
        !this._freeKeyToWindow.has(k) &&
        !this._reservedWindowsMap.has(k),
    );
    let freeKeyIndex = 0;

    // PASSO 3: Atribui as chaves restantes sequencialmente e desenha as badges
    allPreviews.forEach((preview) => {
      const metaWin = preview.metaWindow || preview._metaWindow;
      if (!metaWin || !eligibleWindows.has(metaWin)) return;
      if (!this._isPreviewVisuallyPresent(preview)) return;

      let keyChar = reservedWindowToKey.get(metaWin);

      if (!keyChar) {
        keyChar = this._freeWindowToKey.get(metaWin);
      }

      if (!keyChar) {
        if (freeKeyIndex >= availableKeys.length) return;
        keyChar = availableKeys[freeKeyIndex];
        freeKeyIndex++;
        this._freeKeyToWindow.set(keyChar, metaWin);
        this._freeWindowToKey.set(metaWin, keyChar);
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

  _scheduleWorkspaceRedraw() {
    if (this._workspaceRedrawId) {
      GLib.source_remove(this._workspaceRedrawId);
      this._workspaceRedrawId = 0;
    }

    this._workspaceRedrawId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      WORKSPACE_REDRAW_DELAY_MS,
      () => {
        this._workspaceRedrawId = 0;

        if (!Main.overview.visible) {
          this._workspaceRedrawAttempts = 0;
          return GLib.SOURCE_REMOVE;
        }

        this._drawLabels();

        if (this._workspaceRedrawAttempts < 2) {
          this._workspaceRedrawAttempts += 1;
          this._scheduleWorkspaceRedraw();
          return GLib.SOURCE_REMOVE;
        }

        this._workspaceRedrawAttempts = 0;
        return GLib.SOURCE_REMOVE;
      },
    );
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
    // captured-event fires top-down (capture phase) BEFORE any actor,
    // including the overview search entry — so Shift+Letter is intercepted
    // before search can steal the event.
    this._keyPressId = global.stage.connect("captured-event", (_, event) => {
      return this._handleLetterActivation(event);
    });
  }

  _removeKeyHandler() {
    if (this._keyPressId) {
      global.stage.disconnect(this._keyPressId);
      this._keyPressId = 0;
    }
  }

  _handleLetterActivation(event) {
    if (!event) return Clutter.EVENT_PROPAGATE;

    // VERY IMPORTANT: Only act on key press events to avoid crashes and overhead on motion/scroll events!
    if (event.type() !== Clutter.EventType.KEY_PRESS)
      return Clutter.EVENT_PROPAGATE;

    const symbol = event.get_key_symbol ? event.get_key_symbol() : 0;
    if (!symbol) return Clutter.EVENT_PROPAGATE;

    let keyName = Clutter.keyval_name(symbol);
    if (!keyName) return Clutter.EVENT_PROPAGATE;

    keyName = keyName.toUpperCase();
    if (keyName.length !== 1) return Clutter.EVENT_PROPAGATE;
    if (!ALL_KEYS.includes(keyName)) return Clutter.EVENT_PROPAGATE;

    // Require Shift to be held.
    const state = event.get_state ? event.get_state() : 0;
    const hasShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
    if (!hasShift) return Clutter.EVENT_PROPAGATE;

    const isOverviewVisible = Main.overview.visible;
    // If the user is typing in the search box, let the characters through.
    if (isOverviewVisible) {
      const searchEntry = Main.overview.searchEntry;
      const searchText = searchEntry ? searchEntry.get_text().trim() : "";
      if (searchText.length > 0) return Clutter.EVENT_PROPAGATE;
    }

    this._refreshReservedWindowsMap();

    const win =
      this._windowsMap.get(keyName) ||
      this._reservedWindowsMap.get(keyName) ||
      this._freeKeyToWindow.get(keyName);

    if (!win) return Clutter.EVENT_PROPAGATE;

    if (isOverviewVisible) Main.overview.hide();
    win.activate(global.get_current_time());
    this._clearLabels();
    return Clutter.EVENT_STOP;
  }

  _clearLabels() {
    this._labels.forEach((l) => l.destroy());
    this._labels = [];
    this._windowsMap.clear();
  }

  _cancelWorkspaceRedraw() {
    if (!this._workspaceRedrawId) return;
    GLib.source_remove(this._workspaceRedrawId);
    this._workspaceRedrawId = 0;
  }

  _cleanupFreeAssignments(reservedKeysInUse = new Set()) {
    const eligibleWindows = this._collectEligibleWindows();

    for (const [key, win] of this._freeKeyToWindow.entries()) {
      if (reservedKeysInUse.has(key)) {
        this._freeKeyToWindow.delete(key);
        this._freeWindowToKey.delete(win);
        continue;
      }
      if (eligibleWindows.has(win)) continue;
      this._freeKeyToWindow.delete(key);
      this._freeWindowToKey.delete(win);
    }
  }

  _extractLetterKey(event) {
    if (!event) return "";
    const symbol = event.get_key_symbol ? event.get_key_symbol() : 0;
    if (!symbol) return "";
    const keyName = Clutter.keyval_name(symbol);
    if (!keyName) return "";
    return keyName.toUpperCase();
  }

  _removeWindowAssignments(win) {
    if (!win) return;

    for (const [key, assignedWin] of this._freeKeyToWindow.entries()) {
      if (assignedWin !== win) continue;
      this._freeKeyToWindow.delete(key);
    }
    this._freeWindowToKey.delete(win);

    for (const [key, assignedWin] of this._windowsMap.entries()) {
      if (assignedWin !== win) continue;
      this._windowsMap.delete(key);
    }
  }

  _isWindowAlive(win) {
    if (!win) return false;

    try {
      if (typeof win.get_compositor_private !== "function") return true;
      return win.get_compositor_private() !== null;
    } catch (e) {
      return false;
    }
  }
}
