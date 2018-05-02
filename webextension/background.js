/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

var gState = {};

resetState();

function resetState() {
  gState = {
    activeSlide: "initialPrompt",
    popupActive: gState.popupActive,
  };
}

async function onNavigationCompleted(navDetails) {
  resetState();

  if (shouldQueryUser(navDetails)) {
    await browser.pageAction.show(navDetails.tabId);
    requestAnimationFrame(function() {
      browser.experiments.pageAction.forceOpenPopup();
    });
  }
}

function shouldQueryUser(navDetails) {
  return Math.random() > 0.5;
}

browser.webNavigation.onCompleted.addListener(
  onNavigationCompleted
);

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let { type, action } = message;

  for (let [key, value] of Object.entries(message)) {
    if (key !== "type" && key !== "action") {
      if (!gState.report) {
        gState.report = {};
      }
      gState.report[key] = value;
    }
  }

  switch (type) {
    case "popupOpened":
      gState.popupActive = true;
      sendStateToPopup();
      break;

    case "popupClosed":
      gState.popupActive = false;
      break;

    case "action":
      handleButtonClick(action);
      break;
  }
});

function backgroundSubmitReport() {
  let report = gState.report;
  if (!report) {
    return;
  }
  delete gState.report;

  console.info("Would submit this report: ", report);
}

function handleButtonClick(action) {
  switch (gState.activeSlide) {
    case "initialPrompt":
      if (action === "yes") {
        changeActiveSlide("thankYou");
        backgroundSubmitReport();
        resetState();
      } else {
        changeActiveSlide("requestFeedback");
      }
      break;

    case "requestFeedback":
      if (action === "yes") {
        changeActiveSlide("feedbackForm");
      } else {
        backgroundSubmitReport();
        closePopup();
        resetState();
      }
      break;

    case "feedbackForm":
      if (action === "submit") {
        changeActiveSlide("thankYou");
        backgroundSubmitReport();
      } else {
        closePopup();
      }
      resetState();
      break;
  }
}

function changeActiveSlide(slide) {
  gState.activeSlide = slide;
  sendStateToPopup();
}

function sendStateToPopup() {
  if (gState.popupActive) {
    browser.runtime.sendMessage(gState);
  }
}

function closePopup() {
  if (gState.popupActive) {
    browser.runtime.sendMessage("closePopup");
  }
}
