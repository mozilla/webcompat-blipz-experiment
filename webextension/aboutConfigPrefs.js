/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global ExtensionAPI, Services */

ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

const EventManager = ExtensionCommon.EventManager;

this.aboutConfigPrefs = class extends ExtensionAPI {
  getAPI(context) {
    const extensionIDBase = context.extension.id.split("@")[0];
    const prefBranchPrefix = `extensions.${extensionIDBase}.`;
    const prefBranch = Services.prefs.getBranch(prefBranchPrefix);
    const prefChangeEventName = "experiments.aboutConfigPrefs.onPrefChange";

    function get(type, name) {
      try {
        return prefBranch[`get${type}Pref`](name);
      } catch (_) {
        return undefined;
      }
    }

    return {
      experiments: {
        aboutConfigPrefs: {
          onPrefChange: new EventManager(context, prefChangeEventName, (fire, name) => {
            const callback = () => {
              fire.async();
            };
            Services.prefs.addObserver(`${prefBranchPrefix}${name}`, callback);
            return () => {
              Services.prefs.removeObserver(name, callback);
            };
          }).api(),
          async getBool(name) {
            return get("Bool", name);
          },
          async setBool(name, value) {
            prefBranch.setBoolPref(name, value);
          },
          async getInt(name) {
            return get("Int", name);
          },
          async setInt(name, value) {
            prefBranch.setIntPref(name, value);
          },
          async getString(name) {
            return get("String", name);
          },
          async setString(name, value) {
            prefBranch.setStringPref(name, value);
          },
        },
      },
    };
  }
};
