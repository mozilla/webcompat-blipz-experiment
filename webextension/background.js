/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

var portToPageAction = (function() {
  let port;

  browser.runtime.onConnect.addListener(_port => {
    port = _port;
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(function() {
      port = undefined;
      TabState.get().then(tabState => {
        if (!tabState.inProgress) {
          browser.pageAction.hide(tabState.tabId);
        }
      });
    });

    TabState.get().then(tabState => {
      tabState.maybeUpdatePopup();
    });
  });

  async function send(message) {
    if (port) {
      return port.postMessage(message);
    } else {
      console.trace();
      return Promise.reject("Page action is disconnected");
    }
  }

  function isConnected() {
    return !!port;
  }

  return {send, isConnected};
}());

var TabState = (function() {
  let TabStates = {};

  return class TabState {
    constructor(tabId) {
      this._tabId = tabId;
      this.reset();
    }

    async maybeUpdatePopup(onlyProperties) {
      if (portToPageAction.isConnected() && (await getActiveTab()).id === this._tabId) {
        let info = Object.assign({}, this._report, {
          tabId: this._tabId,
          slide: this._slide,
        });
        let update;
        if (!onlyProperties) {
          update = info;
        } else {
          update = {};
          for (let [name, value] of Object.entries(info)) {
            if (onlyProperties.indexOf(name) >= 0) {
              update[name] = value;
            }
          }
        }
        if (Object.keys(update)) {
          portToPageAction.send(update);
        }
      }
    }

    get inProgress() {
      return this._slide !== "initialPrompt" &&
             this._slide !== "thankYou";
    }

    reset() {
      this._slide = "initialPrompt";
      this._report = {};
    }

    get tabId() {
      return this._tabId;
    }

    get slide() {
      return this._slide;
    }

    set slide(name) {
      this._slide = name;
      this.maybeUpdatePopup(["slide"]);
    }

    get screenshot() {
      return this._report.screenshot;
    }

    updateReport(data) {
      if (Object.keys(data).length) {
        for (let [name, value] of Object.entries(data)) {
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

    async submitReport() {
      let report = this._report;
      if (Object.keys(report).length) {
        const {id} = await getActiveTab();
        if (id === this._tabId) {
          this.updateReport({});
          return backgroundSendReport(report).catch(ex => {
            console.error("Error sending report");
            this.updateReport(report);
            throw ex;
          });
        }
      }

      return Promise.reject();
    }

    static reset(tabId) {
      delete TabStates[tabId];
    }

    static async get(tabId) {
      if (!tabId) {
        tabId = (await getActiveTab()).id;
      }
      if (!TabStates[tabId]) {
        TabStates[tabId] = new TabState(tabId);
      }
      return TabStates[tabId];
    }
  }
}());

function backgroundSendReport(report) {
  console.info("Would submit this report: ", report);
  return Promise.resolve();
}

async function onTabChanged(info) {
  let { tabId } = info;
  let tabState = TabState.get(tabId);
  if (!tabState.inProgress) {
    closePopup();
  } else {
    await showPopup(tabId);
    tabState.maybeUpdatePopup();
  }
}

browser.webNavigation.onCompleted.addListener(onTabChanged);

async function showPopup(tabId) {
  await browser.pageAction.show(tabId);

  return new Promise(resolve => {
    requestAnimationFrame(async function() {
      await browser.experiments.pageAction.forceOpenPopup();
      resolve();
    });
  });
}

async function onNavigationCompleted(navDetails) {
  let { tabId } = navDetails;
  TabState.reset(tabId);

  if (shouldQueryUser(navDetails)) {
    showPopup(tabId);
  }
}

browser.webNavigation.onCompleted.addListener(onNavigationCompleted);

function shouldQueryUser(navDetails) {
  return Math.random() > 0.5;
}

async function onMessage(message) {
  let { tabId, type, action } = message;

  let tabState = await TabState.get(tabId);

  delete message.tabId;
  delete message.type;
  delete message.action;
  if (Object.keys(message).length) {
    tabState.updateReport(message);
  }

  switch (type) {
    case "removeScreenshot":
      tabState.updateReport({screenshot: undefined});
      break;

    case "showScreenshot":
      let imgUrl = tabState.screenshot;
      if (imgUrl) {
        browser.tabs.create({url: "about:blank"}).then(tab => {
          browser.tabs.executeScript(tab.id, {
            code: `window.location = "${imgUrl}"`,
            matchAboutBlank: true,
          });
        });
      }
      break;

    case "requestScreenshot":
      browser.tabs.captureVisibleTab().then(screenshot => {
        tabState.updateReport({screenshot});
        tabState.maybeUpdatePopup(["screenshot"]);
      }).catch(error => {
        console.error(browser.i18n.getMessage("errorScreenshotFail"), error);
      });
      return true;

    case "action":
      handleButtonClick(action, tabState);
      break;
  }
}

async function handleButtonClick(action, tabState) {
  switch (tabState.slide) {
    case "initialPrompt":
      if (action === "yes") {
        tabState.submitReport();
        tabState.slide = "thankYou";
      } else {
        tabState.slide = "requestFeedback";
      }
      break;

    case "requestFeedback":
      if (action === "yes") {
        tabState.slide = "feedbackForm";
      } else {
        tabState.submitReport();
        tabState.slide = "thankYou";
        closePopup();
      }
      break;

    case "feedbackForm":
      if (action === "submit") {
        tabState.submitReport();
        tabState.slide = "thankYou";
      } else {
        closePopup();
        tabState.reset();
      }
      break;
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
