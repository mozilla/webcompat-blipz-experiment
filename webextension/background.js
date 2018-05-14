/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

let gCurrentlyPromptingTab;

const Config = (function() {
  browser.experiments.aboutConfigPrefs.clearPrefsOnUninstall(["enabled"]);

  class Config {
    constructor() {
      this._neverShowAgain = false;
      this._skipPrivateBrowsingTabs = true;
      this._lastPromptTime = 0;
      this._domainsToCheck = {
        "accounts.google.com": 0,
        "amazon.com": 0,
        "amazon.in": 0,
        "bing.com": 0,
        "docs.google.com": 0,
        "drive.google.com": 0,
        "facebook.com": 0,
        "flipkart.com": 0,
        "github.com": 0,
        "google.co.in": 0,
        "google.com": 0,
        "inbox.google.com": 0,
        "instagram.com": 0,
        "linkedin.com": 0,
        "mail.google.com": 0,
        "netflix.com": 0,
        "pandora.com": 0,
        "play.google.com": 0,
        "reddit.com": 0,
        "soundcloud.com": 0,
        "theverge.com": 0,
        "twitch.tv": 0,
        "twitter.com": 0,
        "web.whatsapp.com": 0,
        "youtube.com": 0,
      };

      browser.experiments.aboutConfigPrefs.onPrefChange.addListener(
        this._onAboutConfigPrefChanged.bind(this), "enabled");
    }

    _onAboutConfigPrefChanged() {
      browser.experiments.aboutConfigPrefs.getBool("enabled").then(value => {
        if (value !== undefined) {
          this._neverShowAgain = !value;
          if (value) {
            activate();
          } else {
            deactivate();
          }
        }
      });
    }

    load() {
      return Promise.all([
        browser.experiments.browserInfo.getBuildID(),
        browser.experiments.browserInfo.getUpdateChannel(),
        browser.experiments.aboutConfigPrefs.getBool("enabled"),
        browser.storage.local.get(),
      ]).then(([buildID, releaseChannel, enabledPref, otherPrefs]) => {
        this._buildID = buildID;
        this._releaseChannel = releaseChannel;

        // The "never show again" option is stored in about:config
        // so users can reset it. The rest are stored in the web
        // extension local store, as users would not benefit
        // from them being in about:config anyway.
        if (enabledPref !== undefined) {
          this._neverShowAgain = !enabledPref;
        }

        // The list of domains to check needs special handling, as the list may
        // change when the addon updates, and we must keep the new ones and
        // remove the no-longer-interesting ones, while retaining whether the
        // user has been prompted for any of the final domains.
        if ("domainsToCheck" in otherPrefs) {
          let foundChange = false;
          const oldDomains = otherPrefs.domainsToCheck;
          for (const domain of Object.keys(this._domainsToCheck)) {
            if (domain in oldDomains) {
              this._domainsToCheck[domain] = oldDomains[domain];
              foundChange = true;
            }
          }
          if (foundChange) {
            this.save({domainsToCheck: this._domainsToCheck});
          }
          delete otherPrefs.domainsToCheck;
        }

        // The rest of the values can just be set on the object as-is, since
        // we will have written them out with a valid value to begin with.
        for (const [name, value] of Object.entries(otherPrefs)) {
          this[`_${name}`] = value;
        }
      });
    }

    save(options) {
      const promises = [];
      if ("neverShowAgain" in options) {
        promises.push(browser.experiments.aboutConfigPrefs.setBool(
                        "enabled", !options.neverShowAgain));
        delete options.neverShowAgain;
      }
      if (Object.keys(options).length) {
        promises.push(browser.storage.local.set(options));
      }
      return Promise.all(promises);
    }

    onUserPrompted(domain) {
      const now = Date.now();
      this._lastPromptTime = now;
      this._domainsToCheck[domain] = now;
      this.save({
        lastPromptTime: now,
        domainsToCheck: this._domainsToCheck,
      });
    }

    findDomainMatch(domain) {
      for (const candidate of Object.keys(this._domainsToCheck)) {
        if (domain.endsWith(candidate)) {
          return candidate;
        }
      }
      return undefined;
    }

    shouldPromptUserNow(domain) {
      // Prompt at most once a day, at a minimum once every three days,
      // for a maximum of five prompts per user and one prompt per domain.
      if (this._lastPromptTime) {
        const now = Date.now();
        const oneDay = 1000 * 60 * 60 * 24;
        const nextValidCheckTime = this._lastPromptTime + oneDay;
        const nextNecessaryCheckTime = this._lastPromptTime - (oneDay * 3);
        if (now < nextValidCheckTime &&
            (now > nextNecessaryCheckTime || Math.random() > 0.5)) {
          return false;
        }
      }

      const domainMatch = this.findDomainMatch(domain);
      return domainMatch && !this._domainsToCheck[domainMatch];
    }

    get screenshotFormat() {
      return {format: "jpeg", quality: 75};
    }

    get lastPromptTime() {
      return this._lastPromptTime;
    }

    get neverShowAgain() {
      return this._neverShowAgain;
    }

    set neverShowAgain(bool) {
      this._neverShowAgain = bool;
      this.save({neverShowAgain: bool});
    }

    get skipPrivateBrowsingTabs() {
      return this._skipPrivateBrowsingTabs;
    }

    set skipPrivateBrowsingTabs(bool) {
      this._skipPrivateBrowsingTabs = bool;
      this.save({skipPrivateBrowsingTabs: bool});
    }

    get releaseChannel() {
      return this._releaseChannel;
    }

    get buildID() {
      return this._buildID;
    }
  }

  return new Config();
}());

async function shouldPromptUser(navDetails) {
  if (gCurrentlyPromptingTab) {
    return gCurrentlyPromptingTab.id === navDetails.tabId;
  }

  try {
    const url = new URL(navDetails.url);
    return !Config.neverShowAgain &&
           ["http:", "https:"].includes(url.protocol) &&
           Config.shouldPromptUserNow(url.host) &&
           (!Config.skipPrivateBrowsingTabs ||
            !(await browser.tabs.get(navDetails.tabId)).incognito);
  } catch (_) {
    return false;
  }
}

function backgroundSendReport(report) {
  console.info("Would submit this report: ", report);
  return Promise.resolve();
}

const portToPageAction = (function() {
  let port;

  browser.runtime.onConnect.addListener(_port => {
    port = _port;
    port.onMessage.addListener(onMessageFromPageAction);
    port.onDisconnect.addListener(function() {
      port = undefined;
      gCurrentlyPromptingTab = undefined;
      TabState.get().then(tabState => {
        // When the popup is hidden.
        updatePageActionIcon(tabState.tabId);
        if (Config.neverShowAgain) {
          deactivate();
        }
      });
    });

    TabState.get().then(tabState => {
      const tabId = tabState.tabId;
      gCurrentlyPromptingTab = {id: tabId, url: tabState.url};
      updatePageActionIcon(tabId);
      tabState.maybeUpdatePageAction();
    });
  });

  async function send(message) {
    if (port) {
      return port.postMessage(message);
    }
    console.trace();
    return Promise.reject("Page action is disconnected");
  }

  function isConnected() {
    return !!port;
  }

  return {send, isConnected};
}());

const TabState = (function() {
  const TabStates = {};

  return class TabState {
    constructor(tabId, url) {
      this._tabId = tabId;
      this._url = url;
      this.reset();
    }

    async maybeUpdatePageAction(onlyProperties) {
      if (portToPageAction.isConnected() && ((await getActiveTab()) || {}).id === this._tabId) {
        const info = Object.assign({}, this._report, {
          tabId: this._tabId,
          slide: this._slide,
        });
        let update;
        if (!onlyProperties) {
          update = info;
        } else {
          update = {};
          for (const [name, value] of Object.entries(info)) {
            if (onlyProperties.includes(name)) {
              update[name] = value;
            }
          }
        }
        if (Object.keys(update).length) {
          portToPageAction.send(update);
        }
      }
    }

    reset() {
      this._slide = "initialPrompt";
      this._report = {includeURL: true};
    }

    get url() {
      return this._url;
    }

    set url(url) {
      this._url = url;
    }

    get tabId() {
      return this._tabId;
    }

    get slide() {
      return this._slide;
    }

    set slide(name) {
      this._slide = name;
      updatePageActionIcon(this._tabId);
      this.maybeUpdatePageAction(["slide"]);
    }

    get screenshot() {
      return this._report.screenshot;
    }

    updateReport(data) {
      if (Object.keys(data).length) {
        for (const [name, value] of Object.entries(data)) {
          if (value === undefined) {
            delete this._report[name];
          } else {
            this._report[name] = value;
          }
        }
      } else {
        this._report = {};
      }
    }

    async markAsVerified() {
      gCurrentlyPromptingTab = undefined;
      await updatePageActionIcon(this._tabId);
    }

    async submitReport() {
      if (this._reportSubmitPromise) {
        return this._reportSubmitPromise;
      }

      this._reportSubmitPromise = new Promise(async (resolve, reject) => {
        const report = this._report;
        const { incognito } = await browser.tabs.get(this._tabId);
        if (incognito !== undefined) {
          report.incognito = incognito;
        }
        if ("includeURL" in report !== undefined) {
          if (report.includeURL) {
            report.url = this._url;
          }
          delete report.includeURL;
        }
        this.updateReport({});
        return backgroundSendReport(report).then(() => {
          delete this._reportSubmitPromise;
          resolve();
        }).catch(error => {
          console.error(browser.i18n.getMessage("errorSendingReport"), error);
          this.updateReport(report);
          delete this._reportSubmitPromise;
          reject(error);
        });
      });
      return this._reportSubmitPromise;
    }

    static reset(tabId) {
      delete TabStates[tabId];
    }

    static async get(tabId) {
      let tab;
      if (!tabId) {
        tab = await getActiveTab();
        if (!tab) {
          return undefined;
        }
        tabId = tab.id;
      }
      if (!tab) {
        tab = await browser.tabs.get(tabId);
      }
      if (!TabStates[tabId]) {
        TabStates[tabId] = new TabState(tabId, tab.url);
      }
      const tabState = TabStates[tabId];
      tabState.url = tab.url;
      return tabState;
    }
  };
}());

async function onTabChanged(info) {
  const { tabId } = info;

  if (Config.neverShowAgain) {
    browser.pageAction.hide(tabId);
    return;
  }

  await updatePageActionIcon(tabId);

  if (Config.lastPromptTime) {
    await browser.pageAction.show(tabId);
  }

  if ((gCurrentlyPromptingTab || {}).id === tabId) {
    await showPageAction(tabId);

    const tabState = await TabState.get(tabId);
    tabState.maybeUpdatePageAction();
  }
}

async function onNavigationCommitted(navDetails) {
  const { url, tabId, frameId } = navDetails;

  // We only care about top-level navigations, not frames.
  if (frameId !== 0) {
    return;
  }

  // Check if the user navigated away from the URL during a prompt
  // and cancel any in-progress prompting.
  if (gCurrentlyPromptingTab &&
      gCurrentlyPromptingTab.id === tabId &&
      gCurrentlyPromptingTab.url !== url) {
    gCurrentlyPromptingTab = undefined;
    TabState.reset(tabId);
  }

  // Show the page action icon if it's been shown before.
  if (!Config.neverShowAgain && Config.lastPromptTime) {
    updatePageActionIcon(tabId);
    await browser.pageAction.show(tabId);
  }
}

async function onNavigationCompleted(navDetails) {
  const { url, tabId, frameId } = navDetails;

  // We only care about top-level navigations, not frames.
  if (frameId !== 0) {
    return;
  }

  // When the page has loaded, maybe prompt the user.
  if (await shouldPromptUser(navDetails)) {
    gCurrentlyPromptingTab = {id: tabId, url};
    await updatePageActionIcon(tabId);
    await browser.pageAction.show(tabId);
    showPageAction(tabId);
    Config.onUserPrompted(new URL(url).host);
  }
}

async function onMessageFromPageAction(message) {
  const { tabId, type, action } = message;

  if ("neverShowAgain" in message) {
    const neverShowAgain = message.neverShowAgain;
    Config.neverShowAgain = neverShowAgain;
    if (neverShowAgain) {
      return undefined;
    }
    delete message.neverShowAgain;
  }

  const tabState = await TabState.get(tabId);

  delete message.tabId;
  delete message.type;
  delete message.action;
  delete message.option;
  if (Object.keys(message).length) {
    tabState.updateReport(message);
  }

  switch (type) {
    case "removeScreenshot": {
      tabState.updateReport({screenshot: undefined});
      break;
    }
    case "showScreenshot": {
      const imgUrl = tabState.screenshot;
      if (imgUrl) {
        browser.tabs.create({url: "about:blank"}).then(tab => {
          browser.tabs.executeScript(tab.id, {
            code: `window.location = "${imgUrl}"`,
            matchAboutBlank: true,
          });
        });
      }
      break;
    }
    case "requestScreenshot": {
      browser.tabs.captureTab(tabId, Config.screenshotFormat).then(screenshot => {
        tabState.updateReport({screenshot});
        tabState.maybeUpdatePageAction(["screenshot"]);
      }).catch(error => {
        console.error(browser.i18n.getMessage("errorScreenshotFail"), error);
      });
      return true;
    }
    case "action": {
      handleButtonClick(action, tabState);
      break;
    }
  }

  return undefined;
}

function activate() {
  browser.tabs.onActivated.addListener(onTabChanged);
  browser.webNavigation.onCommitted.addListener(onNavigationCommitted);
  browser.webNavigation.onCompleted.addListener(onNavigationCompleted);
}

function deactivate() {
  hidePageActionOnEveryTab();
  gCurrentlyPromptingTab = undefined;
  browser.tabs.onActivated.removeListener(onTabChanged);
  browser.webNavigation.onCommitted.removeListener(onNavigationCommitted);
  browser.webNavigation.onCompleted.removeListener(onNavigationCompleted);
}

Config.load().then(() => {
  if (!Config.neverShowAgain) {
    activate();
  }
});

function hidePageActionOnEveryTab() {
  browser.tabs.query({}).then(tabs => {
    for (const {id} of tabs) {
      browser.pageAction.hide(id);
    }
  });
}

async function handleButtonClick(action, tabState) {
  if (Config.neverShowAgain) {
    browser.pageAction.hide(tabState.tabId);
    return;
  }

  switch (tabState.slide) {
    case "initialPrompt": {
      const userReportsProblem = action !== "yes";
      tabState.updateReport({userReportsProblem});
      if (!userReportsProblem) {
        tabState.submitReport();
        tabState.slide = "thankYou";
        tabState.markAsVerified();
      } else {
        tabState.slide = "feedbackForm";
      }
      break;
    }
    case "feedbackForm": {
      if (action === "submit") {
        tabState.submitReport();
        tabState.slide = "thankYouFeedback";
      } else if (action === "back") {
        tabState.slide = "initialPrompt";
      } else {
        closePageAction();
        tabState.reset();
      }
      tabState.markAsVerified();
      break;
    }
    case "thankYou": {
      closePageAction();
      break;
    }
    case "thankYouFeedback": {
      closePageAction();
      break;
    }
  }
}

async function updatePageActionIcon(tabId) {
  const active = (gCurrentlyPromptingTab || {}).id === tabId;
  const path = active ? "icons/broken_page_active.svg"
                      : "icons/broken_page.svg";
  await browser.pageAction.setIcon({tabId, path});
}

function getActiveTab() {
  return browser.tabs.query({active: true, lastFocusedWindow: true}).then(tabs => {
    return tabs[0];
  });
}

async function showPageAction(tabId) {
  return browser.experiments.pageAction.forceOpenPopup();
}

function closePageAction() {
  if (portToPageAction.isConnected()) {
    portToPageAction.send("closePopup");
  }
}
