/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

const VisitTimeTracker = (function() {
  class VisitTimeTracker {
    // Track how long each tab is the active one for its window or before its
    // URL changes, and then inform listeners of that duration for that URL.
    constructor() {
      this._tabActivatedListener = this._onTabActivated.bind(this);
      this._tabRemovededListener = this._onTabRemoved.bind(this);
      this._tabChangingListener = this._onTabChanging.bind(this);

      this._listeners = {};

      this.onUpdate = {
        addListener: callback => {
          this._addListener("onUpdate", callback);
        },
        hasListener: callback => {
          this._hasListener("onUpdate", callback);
        },
        removeListener: callback => {
          this._removeListener("onUpdate", callback);
        },
      };
    }

    start() {
      this._activeWindowTabs = {};

      browser.tabs.query({active: true}).then(tabs => {
        for (const tab of tabs) {
          if (!this._activeWindowTabs[tab.windowId]) {
            this._onTabActivated(tab);
          }
        }
      });

      browser.tabs.onActivated.addListener(this._tabActivatedListener);
      browser.tabs.onRemoved.addListener(this._tabRemovededListener);
      browser.webNavigation.onCommitted.addListener(this._tabChangingListener);
    }

    stop() {
      browser.tabs.onActivated.removeListener(this._tabActivatedListener);
      browser.tabs.onRemoved.removeListener(this._tabRemovededListener);
      browser.webNavigation.onCommitted.removeListener(this._tabChangingListener);
    }

    _addListener(type, callback) {
      if (!this._listeners[type]) {
        this._listeners[type] = [];
      }
      const listeners = this._listeners[type];
      if (!listeners.includes(callback)) {
        listeners.push(callback);
      }
    }

    _hasListener(type, callback) {
      if (!this._listeners[type]) {
        return false;
      }
      return this._listeners[type].includes(callback);
    }

    _removeListener(type, callback) {
      if (!this._listeners[type]) {
        return;
      }
      this._listeners[type] = this._listeners[type].filter(l => l !== callback);
    }

    async _onTabChanging(details) {
      const {tabId, frameId, url} = details;
      if (frameId) {
        return;
      }

      const {windowId} = await browser.tabs.get(tabId);
      this._onTabActivated({
        id: tabId,
        windowId,
        url,
      });
    }

    async _onTabActivated(tab) {
      const id = tab.id || tab.tabId;
      const oldTab = this._activeWindowTabs[tab.windowId];
      const { url } = await browser.tabs.get(id);
      this._activeWindowTabs[tab.windowId] = {id, url, time: Date.now()};
      if (oldTab) {
        this._fireUpdate(oldTab);
      }
    }

    _onTabRemoved(tab) {
      const oldTab = this._activeWindowTabs[tab.windowId];
      if (oldTab) {
        this._fireUpdate(oldTab);
        delete this._activeWindowTabs[tab.windowId];
      }
    }

    _fireUpdate(tab) {
      this._fireEvent("onUpdate", {
        tabId: tab.id,
        url: tab.url,
        duration: Date.now() - tab.time,
      });
    }

    _fireEvent(type, event) {
      const listeners = this._listeners[type] || [];
      for (const listener of listeners) {
        listener(event);
      }
    }
  }
  return new VisitTimeTracker();
}());
