/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global BrowserWindowTracker, ExtensionAPI, ExtensionUtils, PageActions */

ChromeUtils.defineModuleGetter(this, "PageActions",
                                     "resource:///modules/PageActions.jsm");

ChromeUtils.defineModuleGetter(this, "BrowserWindowTracker",
                                     "resource:///modules/BrowserWindowTracker.jsm");

ChromeUtils.defineModuleGetter(this, "RecentWindow",
                                     "resource:///modules/RecentWindow.jsm");

class PageActionPanelNodeManager {
  constructor(pageAction) {
    const oldAddedListener = pageAction._onShowingInPanel;
    this._concealed = false;
    pageAction._onShowingInPanel = node => {
      this._node = node;
      if (this._concealed) {
        node.style.display = "none";
        this._maybeHidePreviousSeparator();
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
      this._maybeHidePreviousSeparator();
    }
  }
  conceal() {
    this._concealed = true;
    if (this._node) {
      this._node.style.display = "none";
      this._maybeHidePreviousSeparator();
    }
  }
  _maybeHidePreviousSeparator() {
    // Just hiding our element will not hide our related separator, so
    // we have to manage its visibility ourselves.

    // Find the last element in our separator group.
    const lastSibling = this._node.parentNode.lastElementChild;
    let sib = this._node;
    if (lastSibling !== sib) {
      while (sib !== lastSibling && sib.nextElementSibling.nodeName !== "toolbarseparator") {
        sib = sib.nextElementSibling;
      }
    }

    // Walk back up from that element to find the related separator.
    // If all elements in the group are hidden, we should hide that separator.
    sib = sib.previousElementSibling;
    let shouldHideSeparator = true;
    while (sib && sib.nodeName !== "toolbarseparator") {
      if (sib.style.display !== "none") {
        shouldHideSeparator = false;
      }
      sib = sib.previousElementSibling;
    }
    // If we found a separator, then hide or show it as appropriate.
    if (sib) {
      if (shouldHideSeparator) {
        sib.style.display = "none";
      } else {
        sib.style.display = "";
      }
    }
  }
}

function makeWidgetId(id) {
  id = id.toLowerCase();
  // FIXME: This allows for collisions.
  // WebExt hasn't ever had a problem.
  return id.replace(/[^a-z0-9_-]/g, "_");
}

this.pageActionExtras = class extends ExtensionAPI {
  getAPI(context) {
    const extension = context.extension;
    const pageActionAPI = extension.apiManager.getAPI("pageAction", extension,
                                                      context.envType);
    const actionId = makeWidgetId(extension.id);
    const action = PageActions.actionForID(actionId);
    const panelNode = new PageActionPanelNodeManager(action);
    return {
      experiments: {
        pageAction: {
          async forceOpenPopup() {
            try {
              pageActionAPI.handleClick(BrowserWindowTracker.getTopWindow());
            } catch (e) {
              pageActionAPI.handleClick(RecentWindow.getMostRecentBrowserWindow());
            }
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
