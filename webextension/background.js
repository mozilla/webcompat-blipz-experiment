/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser, selectorLoader, VisitTimeTracker */

browser.experiments.pageAction.concealFromPanel();

let gCurrentlyPromptingTab;

let gCancelCurrentPromptDelayCallback;

const Config = (function() {
  browser.experiments.aboutConfigPrefs.clearPrefsOnUninstall([
    "reportEndpoint", "variation", "firstRunTimestamp"
  ]);

  const UIVariants = ["little-sentiment", "more-sentiment",
                      "control", "v1-more-context"];

  class Config {
    constructor() {
      this._loaded = false;
      this._testingMode = true;
      this._skipPrivateBrowsingTabs = true;
      this._lastPromptTime = 0;
      this._totalPrompts = 0;
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
        this._onAboutConfigPrefChanged.bind(this), "variation");
      browser.experiments.aboutConfigPrefs.onPrefChange.addListener(
        this._onAboutConfigPrefChanged.bind(this), "reportEndpoint");
      browser.experiments.aboutConfigPrefs.onPrefChange.addListener(
        this._onAboutConfigPrefChanged.bind(this), "firstRunTimestamp");

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

    _onFirstRunTimestampChanged(firstRunTimestamp) {
      const ms = 14 * 86400 * 1000; // 14 days
      const delayInMinutes = Math.max(firstRunTimestamp + ms - Date.now(), 0);
      const alarmName = `${browser.runtime.id}:studyExpiration`;
      const alarmListener = async alarm => {
        if (alarm.name === alarmName) {
          browser.alarms.onAlarm.removeListener(alarmListener);
          await browser.study.endStudy("expired");
        }
      };
      browser.alarms.onAlarm.addListener(alarmListener);
      browser.alarms.create(alarmName, { delayInMinutes });
    }

    _onAboutConfigPrefChanged(name) {
      if (name === "variation") {
        browser.experiments.aboutConfigPrefs.getString("variation").then(value => {
          if (value !== this._variationPref) {
            this._variationPref = value;
            this._onVariationPrefChanged(value);
          }
        });
      } else if (name === "firstRunTimestamp") {
        browser.experiments.aboutConfigPrefs.getString("firstRunTimestamp").then(value => {
          this._onFirstRunTimestampChanged(parseInt(value));
        });
      } else if (name === "reportEndpoint") {
        browser.experiments.aboutConfigPrefs.getString("reportEndpoint").then(value => {
          if (value !== this._reportLanding) {
            this._onLandingPrefChanged(value);
          }
        });
      }
    }

    async _onVariationPrefChanged(variationPref) {
      // Users may set to an invalid value to request the addon to reset its state.
      const isResetRequest = variationPref === undefined || !UIVariants.includes(variationPref);

      // If the variation pref is actually present, we are in testing mode.
      this._testingMode = variationPref !== undefined;

      // Start a new shield study with the correct testingMode and requested variant (if any).
      try {
        await browser.study.endStudy("testing");
      } catch (_) {}
      this._uiVariant = isResetRequest ? "" : variationPref;
      const studyInfo = await this._activateShield();

      // Check if Shield chose a different variant for us (ie, if the pref was not set).
      if (studyInfo.variation.name !== this._uiVariant) {
        this._uiVariant = studyInfo.variation.name;
        if (this._testingMode) {
          browser.experiments.aboutConfigPrefs.setString("variation", this._uiVariant);
        }
      }

      if (!isResetRequest) {
        // At least reset all tabs to their initial slide, since different variants may not have the same slides.
        TabState.resetAllToInitialSlide();
        return;
      }

      if (this._testingMode) {
        console.info("Resetting add-on state");
      }

      cancelCurrentPromptDelay();

      gCurrentlyPromptingTab = undefined;

      this._lastPromptTime = 0;
      this._totalPrompts = 0;
      for (const key of Object.keys(this._domainsToCheck)) {
        this._domainsToCheck[key] = {};
      }
      this.save({
        lastPromptTime: this._lastPromptTime,
        totalPrompts: this._totalPrompts,
        domainsToCheck: this._domainsToCheck,
      });
    }

    _onLandingPrefChanged(landingPref) {
      this._reportLanding = landingPref;
    }

    get shieldStudySetup() {
      return {
        activeExperimentName: browser.runtime.id,
        allowEnroll: true,
        studyType: "shield",
        telemetry: {
          send: true,
          removeTestingFlag: !this._testingMode,
        },
        endings: {
          // Standard endings
          "user-disable": {
            baseUrls: ["https://www.surveygizmo.com/s3/4662391/Shield-Blipz-v2?reason=disabled"],
          },
          expired: {
            baseUrls: ["https://www.surveygizmo.com/s3/4662391/Shield-Blipz-v2"],
          },
          ineligible: {
          },

          // Study-specific endings
          testing: {
            category: "ended-neutral",
          },
        },
        weightedVariations: UIVariants.map(name => {
          return {name, weight: 1};
        }),
        expire: {
          days: 100000000, // We handle expiry ourselves via browser.alarm (#108)
        },
        testing: {
          variationName: this._uiVariant,
        },
      };
    }

    _activateShield() {
      if (this._shieldActivatedPromise) {
        return this._shieldActivatedPromise;
      }

      this._shieldActivatedPromise = new Promise((resolve, reject) => {
        const endListener = studyInfoOrError => {
          browser.study.onEndStudy.removeListener(endListener);
          browser.study.onReady.removeListener(readyListener);
          this._shieldActivatedPromise = undefined;
          reject(studyInfoOrError);
        };
        const readyListener = studyInfo => {
          browser.study.onEndStudy.removeListener(endListener);
          browser.study.onReady.removeListener(readyListener);
          this._shieldActivatedPromise = undefined;
          resolve(studyInfo);
        };
        browser.study.onEndStudy.addListener(endListener);
        browser.study.onReady.addListener(readyListener);
        browser.studyDebug.reset();
        try {
          browser.study.setup(this.shieldStudySetup).catch(endListener);
        } catch (err) {
          endListener(err);
        }
      });
      return this._shieldActivatedPromise;
    }

    async load() {
      return Promise.all([
        browser.experiments.browserInfo.getAppVersion(),
        browser.experiments.browserInfo.getBuildID(),
        browser.experiments.browserInfo.getPlatform(),
        browser.experiments.browserInfo.getUpdateChannel(),
        browser.experiments.aboutConfigPrefs.getString("variation").then(async value => {
          // This will init the Shield study and ensure that the variation is valid.
          this._variationPref = value;
          await this._onVariationPrefChanged(value);
          return value;
        }),
        browser.experiments.aboutConfigPrefs.getString("reportEndpoint"),
        browser.experiments.aboutConfigPrefs.getString("firstRunTimestamp"),
        browser.storage.local.get(),
      ]).then(([appVersion, buildID, platform, releaseChannel,
                variationPref, landingPref, firstRunTimestamp, otherPrefs]) => {
        this._appVersion = appVersion;
        this._buildID = buildID;
        this._platform = platform;
        this._releaseChannel = releaseChannel;

        if (firstRunTimestamp !== undefined) {
          this._onFirstRunTimestampChanged(parseInt(firstRunTimestamp));
        } else {
          browser.experiments.aboutConfigPrefs.setString("firstRunTimestamp", Date.now().toString());
        }

        // Store the report landing URL in an about:config preference
        // so that mochitests can more easily override the value.
        if (landingPref !== undefined) {
          this._onLandingPrefChanged(landingPref);
        } else {
          this._reportLanding = "https://blipz-experiment-issues.herokuapp.com/new";
          browser.experiments.aboutConfigPrefs.setString("reportEndpoint", this._reportLanding);
        }

        // Testers may override the variation we are using with the pref.
        // They may use an invalid value to request for the addon to reset its state.
        if (variationPref !== undefined) {
          if (UIVariants.includes(variationPref)) {
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

        this._loaded = true;
      });
    }

    save(options) {
      const promises = [];
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
      this._totalPrompts++;
      this._domainsToCheck[domain].lastPromptTime = now;
      this.save({
        lastPromptTime: now,
        totalPrompts: this._totalPrompts,
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

    async shouldPromptUser(tabId, url) {
      try {
        url = new URL(url);
      } catch (_) {
        if (this._testingMode) {
          console.info(`Not prompting user on ${url}: invalid URL`);
        }
        return false;
      }

      const domain = url.host;

      if (!this.isPromptableURL(url)) {
        if (this._testingMode) {
          console.info(`Not prompting user on ${url}: not a promptable URL`);
        }
        return false;
      }

      // Do not prompt on private-browsing tabs.
      if (this._skipPrivateBrowsingTabs &&
          (await browser.tabs.get(tabId)).incognito) {
        if (this._testingMode) {
          console.info(`Not prompting user on ${domain}: study not run for private tabs`);
        }
        return false;
      }

      // Only prompt users at most five times.
      if (this._totalPrompts > 4) {
        if (this._testingMode) {
          console.info(`Not prompting user on ${domain}: have prompted 5 times already`);
        }
        return false;
      }

      const domainMatch = this.findDomainMatch(domain);
      // Only prompt for domains we're interested in.
      if (!domainMatch) {
        if (this._testingMode) {
          console.info(`Not prompting user on ${domain}: domain not part of study`);
        }
        return false;
      }

      // Prompt users at most once per domain.
      if (this._domainsToCheck[domainMatch].lastPromptTime) {
        if (this._testingMode) {
          console.info(`Not prompting user on ${domainMatch}: already prompted user on this domain`);
        }
        return false;
      }

      // If user has never been prompted, decide based on an
      // even distribution.
      if (!this._lastPromptTime) {
        const shouldPrompt = Math.random() > 0.5;
        if (!shouldPrompt && this._testingMode) {
          console.info(`Not prompting user on ${domainMatch}: random choice`);
        }
        return shouldPrompt;
      }

      // Only prompt users at most once a day.
      const now = Date.now();
      const oneDay = 1000 * 60 * 60 * 24;
      const nextValidCheckTime = this._lastPromptTime + oneDay;
      if (now < nextValidCheckTime) {
        if (this._testingMode) {
          console.info(`Not prompting user on ${domainMatch}: have already prompted user today`);
        }
        return false;
      }

      // Make sure to prompt users at least every 3 days.
      const nextNecessaryCheckTime = this._lastPromptTime + (oneDay * 3);
      if (now > nextNecessaryCheckTime) {
        if (this._testingMode) {
          console.info(`Should prompt user now on ${domainMatch}: more than 3 days since last prompt`);
        }
        return true;
      }

      // Between 1-3 days, use an even distribution to decide.
      const shouldPrompt = Math.random() > 0.5;
      if (!shouldPrompt && this._testingMode) {
        console.info(`Not prompting user on ${domainMatch}: random choice`);
      }
      return shouldPrompt;
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

    get loaded() {
      return this._loaded;
    }

    get testingMode() {
      return this._testingMode;
    }

    get reportLanding() {
      return this._reportLanding;
    }

    get screenshotFormat() {
      return {format: "jpeg", quality: 75};
    }

    get lastPromptTime() {
      return this._lastPromptTime;
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

function yesOrNo(bool) {
  return bool ? "yes" : "no";
}

function createPortListener(opts) {
  let port;

  browser.runtime.onConnect.addListener(_port => {
    if (_port.name !== opts.name) {
      return;
    }

    // When the port is opened.
    port = _port;
    if (opts.onMessage) {
      port.onMessage.addListener(opts.onMessage);
    }
    port.onDisconnect.addListener(function() {
      // When the port is closed.
      port = undefined;
      if (opts.onDisconnect) {
        opts.onDisconnect();
      }
    });

    TabState.get().then(tabState => {
      tabState.onPageActionShown();
    });
  });

  async function send(message) {
    if (port) {
      return port.postMessage(message);
    }
    if (Config.testingMode) {
      console.trace();
    }
    return Promise.reject(`${opts.name} disconnected`);
  }

  function isConnected() {
    return !!port;
  }

  return {send, isConnected};
}

const portToPageAction = createPortListener({
  name: "pageActionPopupPort",
  onMessage: onMessageFromPageAction,
  onDisconnect: () => {
    // Update the page action icon for whichever tab we're on now.
    TabState.get().then(tabState => {
      updatePageActionIcon(tabState.tabId);
    });
  },
});

const portToScreenshots = createPortListener({
  name: "screenshotsPort",
  onMessage: onMessageFromScreenshots,
});

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
        const host = new URL(this._report.url).host;
        const domain = Config.findDomainMatch(host) || host;
        const info = Object.assign({}, this._report, {
          domain,
          tabId: this._tabId,
          slide: this._slide,
          preferences: this._userPreferences,
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
      const initialPrompt = {
        "little-sentiment": "initialPrompt",
        "more-sentiment": "initialPromptSentiment",
        "v1-more-context": "initialPromptV1",
      };
      this._slide = initialPrompt[Config.uiVariant];
      this._blipz_session_id = Date.now().toString();
      this.takenPageActionExit = undefined;
      this._userPreferences = {};
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

    get userPrompted() {
      return this._report.userPrompted;
    }

    updateUserPreferences(updates) {
      this._userPreferences = Object.assign(this._userPreferences || {}, updates);
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
        this._report.appVersion = Config.appVersion;
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
      this.takenPageActionExit = "done";
      gCurrentlyPromptingTab = undefined;
      await updatePageActionIcon(this._tabId);
    }

    isShowingThankYouPage() {
      return ["thankYou", "thankYouFeedback",
              "thankYouV1", "thankYouFeedbackV1"].includes(this._slide);
    }

    onPageActionShown() {
      // Send telemetry on whether the user was actively prompted or
      // not the first time the popup is brought up, but also when
      // they call up the popup themselves (but not if they're
      // coming back after clicking an internal link/screenshot).
      if (!this.takenPageActionExit) {
        const selfPrompted = this.userPrompted ? "no" : "yes";
        this.maybeSendTelemetry({selfPrompted});
      }

      // Clear which link/screenshot the user clicked on which closed
      // the popup last time (unless we're done, at which point we don't
      // care if the user dismisses the popup anymore).
      if (this.takenPageActionExit !== "done") {
        this.takenPageActionExit = undefined;
      }

      // Start a new session if opening on a tab already on a thank-you page.
      if (this.isShowingThankYouPage()) {
        this.reset();
        gCurrentlyPromptingTab = undefined;
      }

      gCurrentlyPromptingTab = {id: this._tabId, url: this._url};
      updatePageActionIcon(this._tabId);
      this.maybeUpdatePageAction();
    }

    _backgroundSendReport(data) {
      const typeLabel = browser.i18n.getMessage(`issueLabel${data.type}`);

      const body = ["url", "appVersion", "channel", "platform", "buildID",
                    "experimentBranch", "description", "type"].map(function(name) {
          const label = browser.i18n.getMessage(`detailLabel_${name}`);
          const value = data[name] || "";
          return `**${label}** ${value}`;
        }).join("\n");

      const host = new URL(data.url).host;
      const domain = Config.findDomainMatch(host) || host;

      const report = {
        title: `${domain} - ${typeLabel}`,
        body,
        labels: [`variant-${data.experimentBranch}`],
      };

      if (data.description === "Site is slow") {
        report.labels.push("slow-site");
      }

      if (data.userPrompted) {
        report.labels.push("user-prompted");
      }

      if (data.screenshot) {
        report.screenshot = data.screenshot;
      }

      if (Config.testingMode) {
        console.info("Would submit this report: ", report);
        report.labels.push("testing");
      }

      const fd = new FormData();
      for (const [key, value] of Object.entries(report)) {
        fd.append(key, value);
      }
      return fetch(Config.reportLanding, {
        body: fd,
        method: "POST",
      }).then(async response => {
        if (!response.ok) {
          throw new DOMException(
            `Got ${response.status} status from server: ${response.statusText}`,
            "NetworkError");
        }
      }).catch(error => {
        this.maybeSendTelemetry({reportSendError: error.message});
      });
    }

    maybeSendTelemetry(message) {
      const finalMessage = Object.assign({
        blipz_session_id: this._blipz_session_id,
        uiVariant: Config._uiVariant,
      }, message);

      if (Config.testingMode) {
        console.info("Sending telemetry", finalMessage);
      }

      return browser.study.sendTelemetry(finalMessage);
    }

    async submitReport() {
      if (this._reportSubmitPromise) {
        return this._reportSubmitPromise;
      }

      this.maybeSendTelemetry({shareFeedBack: "userSubmitted"});

      this._reportSubmitPromise = new Promise(async (resolve, reject) => {
        const report = this._report;
        this.updateReport();
        return this._backgroundSendReport(report).then(() => {
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

    static resetAllToInitialSlide() {
      for (const tab of Object.values(TabStates)) {
        tab.reset();
      }
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

async function onWindowChanged(windowId) {
  // If no window is active now, cancel the current prompt.
  if (windowId === -1) {
    cancelCurrentPromptDelay();
    return;
  }

  const tabs = await browser.tabs.query({windowId, active: true});
  if (tabs[0]) {
    handleTabChange(tabs[0].id, tabs[0].url);
  }
}

async function onTabChanged(info) {
  const { tabId } = info;
  const { url } = await browser.tabs.get(tabId);
  handleTabChange(tabId, url);
}

async function handleTabChange(tabId, url) {
  // Don't do anything for the control experiment
  if (Config._uiVariant === "control") {
    return;
  }

  cancelCurrentPromptDelay();

  if (!Config.isPromptableURL(url)) {
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

  if (Config.lastPromptTime && !tabState.isTakingScreenshot) {
    await browser.pageAction.show(tabId);
  }

  if (gCurrentlyPromptingTab) {
    if (gCurrentlyPromptingTab.id === tabId) {
      await popupPageAction(tabId);
      tabState.maybeUpdatePageAction();
    }
  } else {
    try {
      await maybePromptUser(tabId, url);
    } catch (_) { }
  }
}

async function onNavigationCommitted(navDetails) {
  // Don't do anything for the control experiment
  if (Config._uiVariant === "control") {
    return;
  }

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
    cancelCurrentPromptDelay();
    gCurrentlyPromptingTab = undefined;
    TabState.reset(tabId);
  }

  // Show the page action icon if it's been shown before.
  if (Config.lastPromptTime &&
      Config.isPromptableURL(url)) {
    updatePageActionIcon(tabId);
    const tabState = await TabState.get(tabId);
    if (!tabState.isTakingScreenshot) {
      await browser.pageAction.show(tabId);
    }
  }
}

async function onNavigationCompleted(navDetails) {
  // Don't do anything for the control experiment
  if (Config._uiVariant === "control") {
    return;
  }

  const { url, tabId, frameId } = navDetails;

  // We only care about top-level navigations, not frames.
  if (frameId !== 0) {
    return;
  }

  await maybePromptUser(tabId, url);
}

async function maybePromptUser(tabId, url) {
  if (await Config.shouldPromptUser(tabId, url)) {
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
        gCancelCurrentPromptDelayCallback = undefined;
        browser.runtime.onMessage.removeListener(onMessage);
        VisitTimeTracker.onUpdate.removeListener(onCancel);
        browser.tabs.onActivated.removeListener(onCancel);
        browser.windows.onFocusChanged.removeListener(onCancel);
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
      gCancelCurrentPromptDelayCallback = undefined;
      browser.runtime.onMessage.removeListener(onMessage);
      VisitTimeTracker.onUpdate.removeListener(onCancel);
      browser.tabs.onActivated.removeListener(onCancel);
      browser.windows.onFocusChanged.removeListener(onCancel);
      if (Config.testingMode) {
        console.info("Canceled automated prompt");
      }
      reject();
    };
    browser.runtime.onMessage.addListener(onMessage);
    VisitTimeTracker.onUpdate.addListener(onCancel);
    browser.tabs.onActivated.addListener(onCancel);
    browser.windows.onFocusChanged.addListener(onCancel);
    gCancelCurrentPromptDelayCallback = onCancel;

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

function cancelCurrentPromptDelay() {
  if (gCancelCurrentPromptDelayCallback) {
    gCancelCurrentPromptDelayCallback();
    gCancelCurrentPromptDelayCallback = undefined;
  }
}

async function promptUser(tabId, url) {
  url = url || await browser.tabs.get(tabId).url;
  gCurrentlyPromptingTab = {id: tabId, url};
  await updatePageActionIcon(tabId);
  await browser.pageAction.show(tabId);
  popupPageAction(tabId);
  (await TabState.get(tabId)).updateReport({userPrompted: true});
  Config.onUserPrompted(url);
}

function hideRealScreenshotsUI(tabId) {
  browser.tabs.executeScript(tabId, {
    runAt: "document_start",
    code: `(function() {
      const screenshots = document.querySelector("#firefox-screenshots-preselection-iframe");
      if (screenshots) {
        screenshots.style.display = "none";
        screenshots.id = "old-firefox-screenshots-preselection-iframe";
      }
    })()`
  });
}

function unhideRealScreenshotsUI(tabId) {
  browser.tabs.executeScript(tabId, {
    runAt: "document_start",
    code: `(function() {
      const screenshots = document.querySelector("#old-firefox-screenshots-preselection-iframe");
      if (screenshots) {
        screenshots.style.display = "";
        screenshots.id = "firefox-screenshots-preselection-iframe";
      }
    })()`
  });
}

async function onMessageFromScreenshots({name, args}) {
  const tabState = await TabState.get();
  if (!tabState || !gCurrentlyPromptingTab ||
      gCurrentlyPromptingTab.id !== tabState.tabId) {
    return;
  }

  switch (name) {
    case "closeSelector": {
      await popupPageAction(tabState.tabId);
      tabState.maybeUpdatePageAction();
      hideRealScreenshotsUI(tabState.tabId);
      break;
    }
    case "takeShot": {
      const screenshot = Object.values(args[0].shot.clips)[0].image.url;
      tabState.updateReport({screenshot});
      tabState.maybeUpdatePageAction(["screenshot"]);
      unhideRealScreenshotsUI(tabState.tabId);
      await popupPageAction(tabState.tabId);
      break;
    }
  }
}

function loadScreenshotUI(tabId, tabState) {
  hideRealScreenshotsUI(tabId);
  closePageAction();
  selectorLoader.loadModules(); // activate the screenshots UI
  tabState.isTakingScreenshot = true;
}

async function onMessageFromPageAction(message) {
  const { tabId, command, preferences, exit } = message;

  const tabState = await TabState.get(tabId);

  if ("neverShowAgain" in message) {
    const after = () => {
      try {
        browser.study.endStudy("user-disable").then(deactivate).catch(deactivate);
      } catch (_) {
        deactivate();
      }
    };
    tabState.maybeSendTelemetry({clickedDontShowAgain: "yes"}).catch(after).then(after);
    return undefined;
  }

  if (preferences) {
    tabState.updateUserPreferences(preferences);
  }

  delete message.tabId;
  delete message.textareaHeight;
  delete message.command;
  delete message.exit;
  if (Object.keys(message).length) {
    tabState.updateReport(message);
  }

  switch (command) {
    case "leavingPageAction": {
      if (exit) {
        tabState.takenPageActionExit = exit;
        if (exit === "why") {
          tabState.maybeSendTelemetry({clickedWhySeeingThis: "yes"});
        } else if (exit === "learnMore") {
          tabState.maybeSendTelemetry({clickedLearnMore: "yes"});
        }
      }
      break;
    }
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
    case "takeScreenshot":
    case "retakeScreenshot": {
      loadScreenshotUI(tabId, tabState);
      break;
    }
    default: {
      handleButtonClick(command, tabState);
      break;
    }
  }

  return undefined;
}

let active = false;

function activate() {
  if (active) {
    return;
  }
  VisitTimeTracker.start();
  browser.tabs.onActivated.addListener(onTabChanged);
  browser.windows.onFocusChanged.addListener(onWindowChanged);
  browser.webNavigation.onCommitted.addListener(onNavigationCommitted);
  browser.webNavigation.onCompleted.addListener(onNavigationCompleted);
  browser.study.onEndStudy.addListener(deactivate);
  active = true;
}

function deactivate(studyEndInfo = {}) {
  // If the user was testing toggling the UI variation pref, don't deactivate.
  if (studyEndInfo.endingName === "testing") {
    return;
  }

  for (const url of studyEndInfo.urls || []) {
    browser.tabs.create({url});
  }

  if (!active) {
    return;
  }

  active = false;
  cancelCurrentPromptDelay();
  VisitTimeTracker.stop();
  hidePageActionOnEveryTab();
  gCurrentlyPromptingTab = undefined;
  browser.tabs.onActivated.removeListener(onTabChanged);
  browser.windows.onFocusChanged.removeListener(onWindowChanged);
  browser.webNavigation.onCommitted.removeListener(onNavigationCommitted);
  browser.webNavigation.onCompleted.removeListener(onNavigationCompleted);
  if (studyEndInfo.shouldUninstall) {
    browser.management.uninstallSelf();
  }
}

Config.load().then(activate).catch(loadingError => {
  if (Config.testingMode) {
    console.info("Failed to start addon; uninstalling:", loadingError);
  }
  browser.management.uninstallSelf();
});

function hidePageActionOnEveryTab() {
  browser.tabs.query({}).then(tabs => {
    for (const {id} of tabs) {
      browser.pageAction.hide(id);
    }
  });
}

function handleCancelAction(command, tabState) {
  if (command === "cancel") {
    closePageAction();
    tabState.maybeSendTelemetry({shareFeedBack: "userCancelled"});
    tabState.reset();
  }
}

const SlideButtonClickHandlers = {};

async function handleButtonClick(command, tabState) {
  const handler = SlideButtonClickHandlers[tabState.slide];
  handler && handler(command, tabState);
}

SlideButtonClickHandlers.initialPrompt = (command, tabState) => {
  if (command === "yes") {
    tabState.maybeSendTelemetry({satisfiedSitePrompt: "yes"});
    tabState.slide = "thankYouFeedback";
    tabState.markAsVerified();
  } else {
    tabState.maybeSendTelemetry({satisfiedSitePrompt: "no"});
    tabState.slide = "performancePrompt";
  }
  handleCancelAction(command, tabState);
};

SlideButtonClickHandlers.initialPromptSentiment = (command, tabState) => {
  if (command === "yes") {
    tabState.maybeSendTelemetry({satisfiedSitePrompt: "yes"});
    tabState.slide = "thankYouFeedback";
    tabState.markAsVerified();
  } else if (command === "slow") {
    tabState.maybeSendTelemetry({satisfiedSitePrompt: "slow"});
    tabState.slide = "performanceFeedback";
  } else if (command === "no") {
    tabState.maybeSendTelemetry({satisfiedSitePrompt: "no"});
    if (!tabState.screenshot) {
      loadScreenshotUI((gCurrentlyPromptingTab || {}).id, tabState);
    }
    tabState.slide = "problemReport";
  }
  handleCancelAction(command, tabState);
};

SlideButtonClickHandlers.performancePrompt = (command, tabState) => {
  if (command === "performanceIssue") {
    tabState.maybeSendTelemetry({slowOrSomethingElse: "slow"});
    tabState.slide = "performanceFeedback";
  } else if (command === "somethingElse") {
    tabState.maybeSendTelemetry({slowOrSomethingElse: "somethingElse"});
    if (!tabState.screenshot) {
      loadScreenshotUI((gCurrentlyPromptingTab || {}).id, tabState);
    }
    tabState.slide = "problemReport";
  } else if (command === "back") {
    tabState.slide = "initialPromptSentiment";
  }
  handleCancelAction(command, tabState);
};

SlideButtonClickHandlers.performanceFeedback = (command, tabState) => {
  if (command === "submitPerformanceFeedback") {
    tabState.updateReport({description: "Site is slow"});
    tabState.submitReport();
    tabState.slide = "thankYouFeedback";
    tabState.markAsVerified();
  } else if (command === "back") {
    if (Config.uiVariant === "more-sentiment") {
      tabState.slide = "initialPromptSentiment";
    } else {
      tabState.slide = "performancePrompt";
    }
  }
  handleCancelAction(command, tabState);
};

SlideButtonClickHandlers.problemReport = (command, tabState) => {
  if (command === "submitProblemReport") {
    tabState.submitReport();
    tabState.slide = "thankYouFeedback";
    tabState.markAsVerified();
  } else if (command === "back") {
    if (Config.uiVariant === "more-sentiment") {
      tabState.slide = "initialPromptSentiment";
    } else {
      tabState.slide = "performancePrompt";
    }
  }
  handleCancelAction(command, tabState);
};

SlideButtonClickHandlers.thankYouFeedback = (command, tabState) => {
  closePageAction();
};

SlideButtonClickHandlers.initialPromptV1 = (command, tabState) => {
  const siteWorks = command === "yes";
  tabState.maybeSendTelemetry({satisfiedSitePrompt: yesOrNo(siteWorks)});
  if (siteWorks) {
    tabState.slide = "thankYouV1";
    tabState.markAsVerified();
  } else {
    tabState.slide = "feedbackFormV1";
  }
};

SlideButtonClickHandlers.thankYouV1 = (command, tabState) => {
  closePageAction();
  handleCancelAction(command, tabState);
};

SlideButtonClickHandlers.thankYouFeedbackV1 = (command, tabState) => {
  closePageAction();
};

SlideButtonClickHandlers.feedbackFormV1 = (command, tabState) => {
  if (command === "submitFeedbackV1") {
    tabState.submitReport();
    tabState.slide = "thankYouFeedbackV1";
    tabState.markAsVerified();
  } else if (command === "showFeedbackDetails") {
    tabState.slide = "feedbackDetailsV1";
    tabState.maybeUpdatePageAction(["type", "description"]);
  } else if (command === "back") {
    tabState.slide = "initialPromptV1";
  } else if (command === "cancel") {
    tabState.maybeSendTelemetry({shareFeedBack: "userCancelled"});
    closePageAction();
    tabState.reset();
    tabState.markAsVerified();
  }
};

SlideButtonClickHandlers.feedbackDetailsV1 = (command, tabState) => {
  if (command === "submitFeedbackV1") {
    tabState.submitReport();
    tabState.slide = "thankYouFeedbackV1";
    tabState.markAsVerified();
  } else if (command === "back") {
    tabState.slide = "feedbackFormV1";
  } else if (command === "cancel") {
    tabState.maybeSendTelemetry({shareFeedBack: "userCancelled"});
    closePageAction();
    tabState.reset();
    tabState.markAsVerified();
  }
};

async function updatePageActionIcon(tabId) {
  const active = (gCurrentlyPromptingTab || {}).id === tabId;
  const path = active ? "icons/notification.svg"
                      : "icons/notification.svg";
  await browser.pageAction.setIcon({tabId, path});
}

function getActiveTab() {
  return browser.tabs.query({active: true, lastFocusedWindow: true}).then(tabs => {
    return tabs[0];
  });
}

async function popupPageAction(tabId) {
  const tabState = await TabState.get(tabId);
  if (tabState.isTakingScreenshot) {
    tabState.isTakingScreenshot = false;
    selectorLoader.unloadIfLoaded(tabId);
  }
  return browser.experiments.pageAction.forceOpenPopup();
}

function closePageAction() {
  if (portToPageAction.isConnected()) {
    portToPageAction.send("closePopup");
  }
}

browser.commands.onCommand.addListener(async command => {
  // Don't do anything for the control experiment
  if (Config._uiVariant === "control") {
    return;
  }

  if (command === "show-popup" && Config.testingMode) {
    cancelCurrentPromptDelay();
    const {id, url} = await getActiveTab();
    promptUser(id, url);
  }
});
