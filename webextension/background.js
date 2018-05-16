/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

let gCurrentlyPromptingTab;

const Config = (function() {
  browser.experiments.aboutConfigPrefs.clearPrefsOnUninstall(["enabled", "variation"]);

  const UIVariants = ["more-context", "little-context", "no-context"];

  class Config {
    constructor() {
      this._testingMode = true;
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

      browser.experiments.aboutConfigPrefs.onPrefChange.addListener(
        this._onAboutConfigPrefChanged.bind(this), "variation");
    }

    _onAboutConfigPrefChanged(name) {
      if (name === "enabled") {
        browser.experiments.aboutConfigPrefs.getBool("enabled").then(value => {
          this._onEnabledPrefChanged(value);
        });
      } else if (name === "variation") {
        browser.experiments.aboutConfigPrefs.getString("variation").then(value => {
          this._onVariationPrefChanged(value);
        });
      }
    }

    _onEnabledPrefChanged(value) {
      if (value !== undefined) {
        this._neverShowAgain = !value;
        if (value) {
          activate();
        } else {
          deactivate();
        }
      }
    }

    _onVariationPrefChanged(variationPref) {
      if (UIVariants.includes(variationPref)) {
        this.uiVariant = variationPref;
        return true;
      }

      // If an invalid value was used, just reset the addon's
      // state and pick a new UI variant (useful for testing).
      this._selectRandomUIVariant();
      this._lastPromptTime = 0;
      for (const key of Object.keys(this._domainsToCheck)) {
        this._domainsToCheck[key] = 0;
      }
      this.save({
        lastPromptTime: this._lastPromptTime,
        domainsToCheck: this._domainsToCheck,
      });
      return false;
    }

    _selectRandomUIVariant() {
      this.uiVariant = UIVariants[Math.floor(Math.random() * UIVariants.length)];

      if (this._testingMode) {
        browser.experiments.aboutConfigPrefs.setString("variation", this._uiVariant);
      }
    }

    load() {
      return Promise.all([
        browser.experiments.browserInfo.getAppVersion(),
        browser.experiments.browserInfo.getBuildID(),
        browser.experiments.browserInfo.getPlatform(),
        browser.experiments.browserInfo.getUpdateChannel(),
        browser.experiments.aboutConfigPrefs.getBool("enabled"),
        browser.experiments.aboutConfigPrefs.getString("variation"),
        browser.storage.local.get(),
      ]).then(([appVersion, buildID, platform, releaseChannel,
                enabledPref, variationPref, otherPrefs]) => {
        this._appVersion = appVersion;
        this._buildID = buildID;
        this._platform = platform;
        this._releaseChannel = releaseChannel;

        // The "never show again" option is stored in about:config
        // so users can reset it. The rest are stored in the web
        // extension local store, as users would not benefit
        // from them being in about:config anyway.
        if (enabledPref !== undefined) {
          this._neverShowAgain = !enabledPref;
        }

        // Testers may use an about:config flag to toggle the UI variant.
        // They may also use an invalid value to reset our config.
        if (this._testingMode && variationPref !== undefined) {
          if (this._onVariationPrefChanged(variationPref)) {
            delete otherPrefs.uiVariant;
          } else {
            otherPrefs = {};
          }
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

        // If a valid UI variant has not otherwise been chosen yet, select one now.
        if (!this._uiVariant) {
          this._selectRandomUIVariant();
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

    isPromptableURL(url) {
      if (!(url instanceof URL)) {
        try {
          url = new URL(url);
        } catch (_) {
          return false;
        }
      }
      return ["http:", "https:"].includes(url.protocol);
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

    get uiVariant() {
      return this._uiVariant;
    }

    set uiVariant(uiVariant) {
      this._uiVariant = uiVariant;
      this.save({uiVariant});
    }

    get appVersion() {
      return this._appVersion;
    }

    get buildID() {
      return this._buildID;
    }

    get platform() {
      return this._platform;
    }

    get releaseChannel() {
      return this._releaseChannel;
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
           Config.isPromptableURL(url) &&
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
      TabState.get().then(tabState => {
        // When the popup is hidden.
        updatePageActionIcon(tabState.tabId);
        if (tabState.isShowingThankYouPage()) {
          tabState.reset();
          gCurrentlyPromptingTab = undefined;
        }
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
          uiVariant: Config.uiVariant,
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
          for (const name of onlyProperties) {
            if (!(name in update)) {
              update[name] = undefined;
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
      this.updateReport();
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

    updateReport(updates) {
      if (updates === undefined) {
        this._report = {};
      } else {
        for (const [name, value] of Object.entries(updates)) {
          if (value === undefined) {
            delete this._report[name];
          } else {
            this._report[name] = value;
          }
        }
      }

      if (!this._report.appVersion) {
        this._report.version = Config.appVersion;
      }
      if (!this._report.experimentBranch) {
        this._report.experimentBranch = Config.uiVariant;
      }
      if (!this._report.buildID) {
        this._report.buildID = Config.buildID;
      }
      if (!this._report.platform) {
        this._report.platform = Config.platform;
      }
      if (!this._report.releaseChannel) {
        this._report.channel = Config.releaseChannel;
      }
      if (!this._report.url) {
        this._report.url = this._url;
      }
    }

    async markAsVerified() {
      gCurrentlyPromptingTab = undefined;
      await updatePageActionIcon(this._tabId);
    }

    isShowingThankYouPage() {
      return ["thankYou", "thankYouFeedback"].includes(this._slide);
    }

    async submitReport() {
      if (this._reportSubmitPromise) {
        return this._reportSubmitPromise;
      }

      this._reportSubmitPromise = new Promise(async (resolve, reject) => {
        const report = this._report;
        this.updateReport();
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
  const { url } = await browser.tabs.get(tabId);

  if (Config.neverShowAgain || !Config.isPromptableURL(url)) {
    browser.pageAction.hide(tabId);
    return;
  }

  // Coming back to a tab on a thank-you page starts anew.
  const tabState = await TabState.get(tabId);
  if (tabState.isShowingThankYouPage()) {
    tabState.reset();
    gCurrentlyPromptingTab = undefined;
  }

  await updatePageActionIcon(tabId);

  if (Config.lastPromptTime) {
    await browser.pageAction.show(tabId);
  }

  if ((gCurrentlyPromptingTab || {}).id === tabId) {
    await popupPageAction(tabId);
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
  if (!Config.neverShowAgain && Config.lastPromptTime &&
      Config.isPromptableURL(url)) {
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
    popupPageAction(tabId);
    Config.onUserPrompted(new URL(url).host);
  }
}

async function onMessageFromPageAction(message) {
  const { tabId, command } = message;

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
  delete message.command;
  if (Object.keys(message).length) {
    tabState.updateReport(message);
  }

  switch (command) {
    case "removeScreenshot": {
      tabState.updateReport({screenshot: undefined});
      tabState.maybeUpdatePageAction(["screenshot"]);
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
    default: {
      handleButtonClick(command, tabState);
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

async function handleButtonClick(command, tabState) {
  if (Config.neverShowAgain) {
    browser.pageAction.hide(tabState.tabId);
    return;
  }

  switch (tabState.slide) {
    case "initialPrompt": {
      const userReportsProblem = command !== "yes";
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
      if (command === "submit") {
        tabState.submitReport();
        tabState.slide = "thankYouFeedback";
      } else if (command === "showFeedbackDetails") {
        tabState.slide = "feedbackDetails";
        tabState.maybeUpdatePageAction(["type", "description"]);
      } else if (command === "back") {
        tabState.slide = "initialPrompt";
      } else if (command === "cancel") {
        closePageAction();
        tabState.reset();
      }
      tabState.markAsVerified();
      break;
    }
    case "feedbackDetails": {
      if (command === "submit") {
        tabState.submitReport();
        tabState.slide = "thankYouFeedback";
        tabState.markAsVerified();
      } else if (command === "back") {
        tabState.slide = "feedbackForm";
      } else if (command === "cancel") {
        closePageAction();
        tabState.reset();
        tabState.markAsVerified();
      }
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

async function popupPageAction(tabId) {
  return browser.experiments.pageAction.forceOpenPopup();
}

function closePageAction() {
  if (portToPageAction.isConnected()) {
    portToPageAction.send("closePopup");
  }
}
