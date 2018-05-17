/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser, VisitTimeTracker */

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
        "accounts.google.com": {},
        "amazon.com": {},
        "amazon.in": {},
        "bing.com": {},
        "docs.google.com": {},
        "drive.google.com": {},
        "facebook.com": {},
        "flipkart.com": {},
        "github.com": {},
        "google.co.in": {},
        "google.com": {},
        "inbox.google.com": {},
        "instagram.com": {},
        "linkedin.com": {},
        "mail.google.com": {},
        "netflix.com": {},
        "pandora.com": {},
        "play.google.com": {},
        "reddit.com": {},
        "soundcloud.com": {},
        "theverge.com": {},
        "twitch.tv": {},
        "twitter.com": {},
        "web.whatsapp.com": {},
        "youtube.com": {},
      };

      browser.experiments.aboutConfigPrefs.onPrefChange.addListener(
        this._onAboutConfigPrefChanged.bind(this), "enabled");

      browser.experiments.aboutConfigPrefs.onPrefChange.addListener(
        this._onAboutConfigPrefChanged.bind(this), "variation");

      VisitTimeTracker.onUpdate.addListener(this._onVisitTimeUpdate.bind(this));
    }

    _onVisitTimeUpdate(details) {
      // Log the total time each domain in active in a foreground tab
      try {
        const {url, duration} = details;
        const domain = this._domainsToCheck[this.findDomainMatch(new URL(url).host)];
        if (domain) {
          domain.totalActiveTime = (domain.totalActiveTime || 0) + duration;
          this.save({domainsToCheck: this._domainsToCheck});
        }
      } catch (_) { }
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
        this._domainsToCheck[key] = {};
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

    onUserPrompted(url) {
      const domain = this.findDomainMatch(new URL(url).host);
      if (!domain) {
        return;
      }
      const now = Date.now();
      this._lastPromptTime = now;
      this._domainsToCheck[domain].lastPromptTime = now;
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
      return domainMatch && !this._domainsToCheck[domainMatch].lastPromptTime;
    }

    cumulativeMillisecondsSpentOnDomain(url) {
      try {
        const domain = this.findDomainMatch(new URL(url).host);
        return this._domainsToCheck[domain].totalActiveTime || 0;
      } catch (_) {
        return 0;
      }
    }

    getDelayBeforePromptingForDomain(url) {
      const minMillisecondsUserTimeOnDomainBeforePrompt = 65000;
      const maxMillisecondsExtraRandomDelay = 5000;

      const min = Math.max(0, minMillisecondsUserTimeOnDomainBeforePrompt -
                              this.cumulativeMillisecondsSpentOnDomain(url));
      const timeout = min + (Math.random() * maxMillisecondsExtraRandomDelay);

      if (this._testingMode) {
        console.info("Prompting user in", timeout / 1000, "seconds on", url);
      }

      return timeout;
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

async function shouldPromptUser(tabId, url) {
  try {
    url = new URL(url);
    return !Config.neverShowAgain &&
           Config.isPromptableURL(url) &&
           Config.shouldPromptUserNow(url.host) &&
           (!Config.skipPrivateBrowsingTabs ||
            !(await browser.tabs.get(tabId)).incognito);
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

  if (gCurrentlyPromptingTab) {
    if (gCurrentlyPromptingTab.id === tabId) {
      await popupPageAction(tabId);
      tabState.maybeUpdatePageAction();
    }
  } else {
    await maybePromptUser(tabId, url);
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

  // If the user was already in mid-prompt on this tab,
  // reopen the prompt.
  if (gCurrentlyPromptingTab && gCurrentlyPromptingTab.id === tabId) {
    await promptUser(tabId, url);
    return;
  }

  await maybePromptUser(tabId, url);
}

async function maybePromptUser(tabId, url) {
  if (await shouldPromptUser(tabId, url)) {
    await waitForGoodTimeToPrompt(tabId, url);
    await promptUser(tabId, url);
  }
}

function waitForGoodTimeToPrompt(tabId, url) {
  // Wait until the user has spent at least a certain number of total seconds
  // on the given domain, then for a few more seconds after the page has loaded,
  // and a requestIdleCallback on top of that for good measure.
  return new Promise((resolve, reject) => {
    // We do this with a content script, which has to let us know when the
    // timeouts/idle callback has fired, so set up the listeners here.
    const onMessage = message => {
      if (message === "ready") {
        browser.runtime.onMessage.removeListener(onMessage);
        VisitTimeTracker.onUpdate.removeListener(onCancel);
        resolve();
      }
    };
    // If the user moves away from the tab/url, then we might as well cancel
    // the timeout and/or idle callback, as all the content script will do
    // is fail to send a message and log an error to the browser console.
    const onCancel = () => {
      browser.tabs.executeScript(tabId, {
        runAt: "document_start",
        code: `
          try { cancelIdleCallback(window.promptIdle); } catch (_) { }
          try { clearTimeout(window.promptTimeout); } catch (_) { }
        `
      });
      browser.runtime.onMessage.removeListener(onMessage);
      VisitTimeTracker.onUpdate.removeListener(onCancel);
      reject();
    };
    browser.runtime.onMessage.addListener(onMessage);
    VisitTimeTracker.onUpdate.addListener(onCancel);

    const delay = Config.getDelayBeforePromptingForDomain(url);
    browser.tabs.executeScript(tabId, {
      runAt: "document_idle",
      code: `
        window.promptTimeout = setTimeout(() => {
          window.promptIdle = requestIdleCallback(() => {
            browser.runtime.sendMessage("ready");
          });
        }, ${delay});
      `
    });
  });
}

async function promptUser(tabId, url) {
  url = url || await browser.tab.get(tabId).url;
  gCurrentlyPromptingTab = {id: tabId, url};
  await updatePageActionIcon(tabId);
  await browser.pageAction.show(tabId);
  popupPageAction(tabId);
  Config.onUserPrompted(url);
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
  VisitTimeTracker.start();
  browser.tabs.onActivated.addListener(onTabChanged);
  browser.webNavigation.onCommitted.addListener(onNavigationCommitted);
  browser.webNavigation.onCompleted.addListener(onNavigationCompleted);
}

function deactivate() {
  VisitTimeTracker.stop();
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
