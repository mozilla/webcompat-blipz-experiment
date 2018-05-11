/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global BrowserWindowTracker, ExtensionAPI, ExtensionUtils, PageActions */

ChromeUtils.defineModuleGetter(this, "PageActions",
                                     "resource:///modules/PageActions.jsm");

ChromeUtils.defineModuleGetter(this, "BrowserWindowTracker",
                                     "resource:///modules/BrowserWindowTracker.jsm");

this.forceOpenPageActionPopup = class extends ExtensionAPI {
  getAPI(context) {
    const extension = context.extension;
    const pageActionAPI = extension.apiManager.getAPI("pageAction", extension,
                                                      context.envType);
    return {
      experiments: {
        pageAction: {
          async forceOpenPopup() {
            const window = BrowserWindowTracker.getTopWindow();
            pageActionAPI.handleClick(window);
          },
        },
      },
    };
  }
};
