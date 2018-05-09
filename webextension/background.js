/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

const gURLThankYou = "https://mozilla.github.io/webcompat-blipz-experiment/thanks.html";

const gMinimumFrequencyBeforeRePrompting = 1000 * 20; // 20 seconds (for testing)
const gSkipPrivateBrowsingTabs = true;

const gDomainCheckTimestamps = {};

let gNeverShowAgain = false;

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
      try {
        await setPageActionIcon(this._tabId, false);
        const { url } = await browser.tabs.get(this._tabId);
        const domain = new URL(url).host;
        gDomainCheckTimestamps[domain] = Date.now();
      } catch (_) { }
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
        if (report.includeURL !== undefined) {
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

  if (await shouldQueryUser(navDetails)) {
    await setPageActionIcon(tabId, true);
    showPopup(tabId);
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
activate();

async function shouldQueryUser(navDetails) {
  try {
    const url = new URL(navDetails.url);
    return !gNeverShowAgain &&
           (url.protocol === "http:" || url.protocol === "https:") &&
           (!gDomainCheckTimestamps[url.host] ||
            gDomainCheckTimestamps[url.host] <
             (Date.now() - gMinimumFrequencyBeforeRePrompting)) &&
           (!gSkipPrivateBrowsingTabs ||
            !(await browser.tabs.get(navDetails.tabId)).incognito) &&
           Math.random() > 0.5;
  } catch (_) {
    return false;
  }
}

async function onMessage(message) {
  const { tabId, type, action, neverShowAgain } = message;

  if (neverShowAgain !== undefined) {
    if (neverShowAgain) {
      gNeverShowAgain = true;
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
  if (gNeverShowAgain) {
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
        browser.tabs.create({url: gURLThankYou});
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
