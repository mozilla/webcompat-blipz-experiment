/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global BrowserWindowTracker, ExtensionAPI, ExtensionUtils, PageActions */

ChromeUtils.defineModuleGetter(this, "PageActions",
                                     "resource:///modules/PageActions.jsm");

ChromeUtils.defineModuleGetter(this, "BrowserWindowTracker",
                                     "resource:///modules/BrowserWindowTracker.jsm");

class PageActionPanelNodeManager {
  constructor(pageAction) {
    const oldAddedListener = pageAction._onPlacedInPanel;
    this._concealed = false;
    pageAction._onPlacedInPanel = node => {
      this._node = node;
      if (this._concealed) {
        node.style.display = "none";
      }
      if (oldAddedListener) {
        oldAddedListener(node);
      }
    };
  }
  unconceal() {
    this._concealed = false;
    if (this._node) {
      this._node.style.display = "";
    }
  }
  conceal() {
    this._concealed = true;
    if (this._node) {
      this._node.style.display = "none";
    }
  }
}

this.pageActionExtras = class extends ExtensionAPI {
  getAPI(context) {
    const extension = context.extension;
    const pageActionAPI = extension.apiManager.getAPI("pageAction", extension,
                                                      context.envType);
    const actionId = ExtensionUtils.makeWidgetId(extension.id);
    const action = PageActions.actionForID(actionId);
    const panelNode = new PageActionPanelNodeManager(action);
    return {
      experiments: {
        pageAction: {
          async forceOpenPopup() {
            const window = BrowserWindowTracker.getTopWindow();
            pageActionAPI.handleClick(window);
          },
          async concealFromPanel() {
            panelNode.conceal();
          },
          async unconcealFromPanel() {
            panelNode.unconceal();
          },
        },
      },
    };
  }
};
