import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";

const VERSION = "v1.3.1 - Fixed Constructor Inspection";

export default class WindowNumberingExtension extends Extension {
  enable() {
    console.log(`[Window-Numbering] Ativando ${VERSION}`);
    this._labels = [];
    this._windowsMap = new Map();

    // Conecta ao evento quando a visão geral termina de ser desenhada
    this._shownId = Main.overview.connect("shown", () => this._drawLabels());
    this._hidingId = Main.overview.connect("hiding", () => this._clearLabels());
  }

  disable() {
    console.log(`[Window-Numbering] Desativando ${VERSION}`);
    if (this._shownId) Main.overview.disconnect(this._shownId);
    if (this._hidingId) Main.overview.disconnect(this._hidingId);
    this._clearLabels();
    this._removeKeyHandler();
  }

  _drawLabels() {
    this._clearLabels();
    this._windowsMap.clear();

    // Varre o container global do Overview em busca dos cards das janelas
    const previews = this._findPreviews(Main.layoutManager.overviewGroup);
    let count = 0;

    previews.forEach((preview) => {
      if (count >= 9) return;

      // Garante que a thumbnail está visível no monitor ativo
      if (!preview.get_mapped || !preview.get_mapped()) return;

      const metaWin = preview.metaWindow || preview._metaWindow;
      if (!metaWin) return;

      count++;
      const numberStr = count.toString();
      this._windowsMap.set(numberStr, metaWin);

      // Pega as coordenadas exatas da thumbnail desenhada na tela
      const [x, y] = preview.get_transformed_position();

      const label = new St.Label({
        text: numberStr,
        style_class: "window-number-badge",
        style: `
          background-color: #3584e4;
          color: white;
          font-weight: bold;
          font-size: 20px;
          border-radius: 14px;
          padding: 6px 12px;
          border: 2px solid white;
          box-shadow: 0px 4px 10px rgba(0,0,0,0.8);
        `,
      });

      Main.uiGroup.add_child(label);
      label.set_position(x + 10, y + 10);
      this._labels.push(label);
    });

    this._setupKeyHandler();
  }

  // Busca recursiva segura pelas thumbnails na árvore visual do Clutter
  _findPreviews(node) {
    let found = [];
    if (!node) return found;

    // Detecta se o elemento é o card de miniatura da janela (WindowPreview)
    const isPreview = node.metaWindow || node._metaWindow;
    const hasPreviewClass =
      node.constructor &&
      (node.constructor.name === "WindowPreview" ||
        node.toString().includes("WindowPreview"));

    if (isPreview && hasPreviewClass) {
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
    this._keyPressId = global.stage.connect(
      "key-press-event",
      (actor, event) => {
        if (!Main.overview.visible) return Clutter.EVENT_PROPAGATE;

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
      },
    );
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
