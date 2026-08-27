import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";

const VERSION = "v1.5.0 - Search Aware";

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

    const activeWorkspace = global.workspace_manager.get_active_workspace();
    const validWindows = activeWorkspace
      .list_windows()
      .filter((w) => w.showing_on_its_workspace() && !w.is_skip_taskbar());

    const allPreviews = this._findPreviews(Main.layoutManager.overviewGroup);
    let count = 0;

    allPreviews.forEach((preview) => {
      if (count >= 9) return;

      const metaWin = preview.metaWindow || preview._metaWindow;
      if (!metaWin || !validWindows.includes(metaWin)) return;

      if (typeof preview.get_mapped === "function" && !preview.get_mapped())
        return;

      count++;
      const numberStr = count.toString();
      this._windowsMap.set(numberStr, metaWin);

      const [x, y] = preview.get_transformed_position();

      const label = new St.Label({
        text: numberStr,
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

      // Se o usuário está digitando algo na busca, ignora a ativação por número
      const searchText = Main.overview.searchEntry.get_text().trim();
      if (searchText.length > 0) return Clutter.EVENT_PROPAGATE;

      const symbol = event.get_key_symbol();
      const keyName = Clutter.keyval_name(symbol);

      if (/^[1-9]$/.test(keyName)) {
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
