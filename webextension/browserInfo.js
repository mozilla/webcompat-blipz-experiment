/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global AppConstants, ExtensionAPI, Services */

ChromeUtils.import("resource://gre/modules/AppConstants.jsm");
ChromeUtils.import("resource://gre/modules/Services.jsm");

this.browserInfo = class extends ExtensionAPI {
  getAPI(context) {
    return {
      experiments: {
        browserInfo: {
          async getAppVersion() {
            return AppConstants.MOZ_APP_VERSION;
          },
          async getBuildID() {
            return Services.appinfo.appBuildID;
          },
          async getUpdateChannel() {
            return AppConstants.MOZ_UPDATE_CHANNEL;
          },
          async getPlatform() {
            return AppConstants.platform;
          },
        },
      },
    };
  }
};
