/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

let gCurrentlyPromptingTabId;

const Config = (function() {
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
    }

    load() {
      // TBD
      return Promise.resolve();
    }

    save(options) {
      // TBD
      console.info("Saving options", options);
    }

    onUserPrompted(domain) {
      const now = Date.now();
      this._lastPromptTime = now;
      this._domainsToCheck[domain] = now;
      this.save({
        lastPromptTime: now,
        domainsToMatch: this._domainsToCheck
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

    get thankYouPageURL() {
      return "https://mozilla.github.io/webcompat-blipz-experiment/thanks.html";
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
  }

  return new Config();
}());

async function shouldPromptUser(navDetails) {
  if (gCurrentlyPromptingTabId) {
    return gCurrentlyPromptingTabId === navDetails.tabId;
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

async function setPageActionIcon(tabId, active) {
  const path = active ? "icons/broken_page_active.svg"
                      : "icons/broken_page.svg";
  await browser.pageAction.setIcon({tabId, path});
}

const portToPageAction = (function() {
  let port;

  browser.runtime.onConnect.addListener(_port => {
    port = _port;
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(function() {
      port = undefined;
      TabState.get().then(tabState => {
        setPageActionIcon(tabState.tabId, tabState.inProgress);
      });
    });

    TabState.get().then(tabState => {
      tabState.maybeUpdatePopup();
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
    constructor(tabId) {
      this._tabId = tabId;
      this.reset();
    }

    async maybeUpdatePopup(onlyProperties) {
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

    get inProgress() {
      return this._slide !== "initialPrompt" &&
             this._slide !== "thankYouFeedback" &&
             this._slide !== "thankYou";
    }

    reset() {
      this._slide = "initialPrompt";
      this._report = {includeURL: true};
    }

    get tabId() {
      return this._tabId;
    }

    get slide() {
      return this._slide;
    }

    set slide(name) {
      this._slide = name;
      setPageActionIcon(this._tabId, this.inProgress);
      this.maybeUpdatePopup(["slide"]);
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
      await setPageActionIcon(this._tabId, false);
      gCurrentlyPromptingTabId = undefined;
    }

    async submitReport() {
      if (this._reportSubmitPromise) {
        return this._reportSubmitPromise;
      }

      this._reportSubmitPromise = new Promise(async (resolve, reject) => {
        const report = this._report;
        const { incognito, url } = await browser.tabs.get(this._tabId);
        if (incognito !== undefined) {
          report.incognito = incognito;
        }
        if ("includeURL" in report !== undefined) {
          if (report.includeURL) {
            report.url = url;
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

    static hidePageActions() {
      for (const tab of Object.values(TabStates)) {
        browser.pageAction.hide(tab._tabId);
      }
    }

    static reset(tabId) {
      delete TabStates[tabId];
    }

    static async get(tabId) {
      if (!tabId) {
        tabId = (await getActiveTab()).id;
        if (!tabId) {
          return undefined;
        }
      }
      if (!TabStates[tabId]) {
        TabStates[tabId] = new TabState(tabId);
      }
      return TabStates[tabId];
    }
  };
}());

function backgroundSendReport(report) {
  console.info("Would submit this report: ", report);
  return Promise.resolve();
}

async function onTabChanged(info) {
  const { tabId } = info;
  const tabState = await TabState.get(tabId);
  await setPageActionIcon(tabId, tabState.inProgress);
  if (tabState.inProgress) {
    await showPopup(tabId);
    tabState.maybeUpdatePopup();
  }
}

async function showPopup(tabId) {
  await browser.pageAction.show(tabId);

  /* return new Promise(resolve => {
     requestAnimationFrame(async function() {
       await browser.experiments.pageAction.forceOpenPopup();
       resolve();
     });
   });*/
}

let gCurrentTabUrl;

async function onNavigationCompleted(navDetails) {
  const { url, tabId } = navDetails;

  if (url && url === gCurrentTabUrl) {
    const tabState = await TabState.get(tabId);
    await setPageActionIcon(tabId, tabState.inProgress);
    browser.pageAction.show(tabId);
    return;
  }

  TabState.reset(tabId);
  gCurrentTabUrl = url;

  if (await shouldPromptUser(navDetails)) {
    gCurrentlyPromptingTabId = navDetails.tabId;
    await setPageActionIcon(tabId, true);
    showPopup(tabId);

    const domain = new URL(url).host;
    Config.onUserPrompted(domain);
  }
}

function activate() {
  browser.tabs.onActivated.addListener(onTabChanged);
  browser.webNavigation.onCompleted.addListener(onNavigationCompleted);
}

function deactivate() {
  TabState.hidePageActions();
  gCurrentTabUrl = undefined;
  browser.tabs.onActivated.removeListener(onTabChanged);
  browser.webNavigation.onCompleted.removeListener(onNavigationCompleted);
}

Config.load().then(activate);

async function onMessage(message) {
  const { tabId, type, action } = message;

  if ("neverShowAgain" in message) {
    if (message.neverShowAgain) {
      Config.neverShowAgain = true;
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
      browser.tabs.captureVisibleTab().then(screenshot => {
        tabState.updateReport({screenshot});
        tabState.maybeUpdatePopup(["screenshot"]);
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

async function handleButtonClick(action, tabState) {
  if (Config.neverShowAgain) {
    deactivate();
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
        browser.tabs.create({url: Config.thankYouPageURL});
      } else {
        closePopup();
        tabState.reset();
      }
      tabState.markAsVerified();
      break;
    }
  }
}

function getActiveTab() {
  return browser.tabs.query({active: true, lastFocusedWindow: true}).then(tabs => {
    return tabs[0];
  });
}

function closePopup() {
  if (portToPageAction.isConnected()) {
    portToPageAction.send("closePopup");
  }
}
