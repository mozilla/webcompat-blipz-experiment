/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

const gState = {};

const gIssueTypeLabels = {
  "siteUnusable": "issueLabelSiteUnusable",
  "brokenDesign": "issueLabelBrokenDesign",
  "playbackFailure": "issueLabelPlaybackFailure",
  "other": "issueLabelOther",
};

const portToBGScript = (function() {
  let port;

  function connect() {
    port = browser.runtime.connect({name: "pageActionPopupPort"});
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(e => {
      port = undefined;
    });
  }

  connect();

  async function send(message) {
    if (port) {
      message.tabId = gState.tabId;
      return port.postMessage(message);
    }
    console.trace();
    return Promise.reject("Background script has disconnected");
  }

  return {send};
}());

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", handleClick);

  for (const [selector, msg] of Object.entries({
    "#initialPrompt > h1.introduction": "titleInitialPromptIntroduction",
    "#initialPrompt > p.introduction": "textInitialPromptIntroduction",
    "#initialPrompt > a": "linkInitialPrompt",
    "#initialPrompt > label": "labelNeverShowAgain",
    "#initialPrompt > div > button.siteWorks": "promptWorks",
    "#initialPrompt > div> button.siteBroken": "promptBroken",
    "#initialPrompt > div > button.siteSlow": "promptSlow",
    "#initialPrompt > p.privacyPolicy": "privacyPolicy",
    "#initialPromptSentiment > h1.introduction": "titleInitialPromptIntroductionSentiment",
    "#initialPromptSentiment > p.introduction": "textInitialPromptIntroduction",
    "#initialPromptSentiment > a": "linkInitialPrompt",
    "#initialPromptSentiment > label": "labelNeverShowAgain",
    "#initialPromptSentiment > div > button.siteWorks": "promptWorks",
    "#initialPromptSentiment > div > button.siteBroken": "promptBroken",
    "#initialPromptSentiment > p.privacyPolicy": "privacyPolicy",
    "#thankYouFeedback > span": "titleThankYouFeedback",
    "button[data-action='ok']": "buttonOK",
    "button[data-action='submitPerformanceFeedback']": "buttonSubmit",
    "button[data-action='submitProblemReport']": "buttonSubmit",
    "button[data-action='cancel']": "buttonCancel",
    "#performancePrompt > h2": "performancePromptIntroduction",
    "#performancePrompt > p": "performancePromptText",
    "#performancePrompt > div > button.performanceIssue": "promptPerformanceIssue",
    "#performancePrompt > div > button.siteBroken": "promptPerformanceOther",
    "#performanceFeedback > h2.introduction": "performanceFeedbackIntroduction",
    "#performanceFeedback > p": "performanceFeedbackText",
    "#problemReport > h2": "problemReportTitle",
    "#problemReport > .missingScreenshot > button": "takeAScreenshot",
    "#problemReport > form > label": "issueDescriptionLabel",
    "#problemReport > form > span": "placeholderIssueType",
  })) {
    const txt = browser.i18n.getMessage(msg);
    for (const node of document.querySelectorAll(selector)) {
      node.appendChild(document.createTextNode(txt));
    }
  }

  for (const [value, msgId] of Object.entries(gIssueTypeLabels)) {
    const input = document.querySelector(`input[value="${value}"]`);
    document.querySelector(`label[for="${input.id}"]`).innerText =
      browser.i18n.getMessage(msgId);
  }

  for (const [name, msgId] of Object.entries({
    "problemDescription": "placeholderIssueDescription",
    "performanceDescription": "placeholderPerformanceDescription"
  })) {
    const input = document.querySelector(`[name=${name}]`);
    input.placeholder = browser.i18n.getMessage(msgId);

    input.addEventListener("change", e => {
      const message = {};
      message[input.name] = input.value;
      gState[name] = input.value;
      portToBGScript.send(message);
    });
  }

  for (const name of ["neverShowAgain"]) {
    const input = document.querySelector(`[name="${name}"]`);

    input.addEventListener("change", e => {
      const message = {};
      message[input.name] = input.checked;
      portToBGScript.send(message);
    });
  }

  autosizeTextArea(document.querySelector("[name=performanceDescription]"));
  autosizeTextArea(document.querySelector("[name=problemDescription]"));
});

function autosizeTextArea(el) {
  function resize() {
    el.style.height = "auto";
    el.style.padding = "0";
    const popup = document.scrollingElement;
    const popupKidHeights = Array.map.call(null, popup.childNodes, n => n.clientHeight);
    const heightOfRest = popupKidHeights.reduce((a, c) => a + (c || 0), 0) - el.clientHeight;
    const maxHeight = 588 - heightOfRest; // 588px seems to be the max-height of the popup
    el.style.height = Math.min(maxHeight, el.scrollHeight) + "px";
  }
  if (!el.getAttribute("data-ready")) {
    el.setAttribute("data-ready", 1);
    el.addEventListener("keydown", resize);
    el.addEventListener("keypress", resize);
    el.addEventListener("keyup", resize);
    el.addEventListener("compositionstart", resize);
    el.addEventListener("compositionupdate", resize);
    el.addEventListener("compositionend", resize);
  }
  resize();
}

function onMessage(update) {
  if (update === "closePopup") {
    window.close();
    return;
  }

  if (update.uiVariant && gState.uiVariant !== update.uiVariant) {
    if (gState.uiVariant) {
      document.documentElement.classList.remove(gState.uiVariant);
    }
    document.documentElement.classList.add(update.uiVariant);
  }

  Object.assign(gState, update);

  if (update.slide) {
    const body = document.querySelector("body");
    document.documentElement.setAttribute("data-slide", update.slide);
    for (const section of document.querySelectorAll("section")) {
      if (section.id !== update.slide) {
        section.classList.remove("active");
      } else {
        section.classList.add("active");
      }
      if (update.slide === "thankYouFeedback") {
        body.classList.add("thankYou");
      } else {
        body.classList.remove("thankYou");
      }
    }
  }

  if (gState.screenshot) {
    showScreenshot(gState.screenshot);
  } else {
    hideScreenshot();
  }

  autosizeTextArea(document.querySelector("[name=performanceDescription]"));
  autosizeTextArea(document.querySelector("[name=problemDescription]"));
}

async function hideScreenshot() {
  document.querySelectorAll(".missingScreenshot").forEach(elem => {
    elem.style.display = "";
  });
  document.querySelectorAll(".screenshot").forEach(elem => {
    elem.style.display = "none";
  });
  document.querySelectorAll(".screenshot > img").forEach(img => {
    img.src = "";
    img.style.display = "";
  });
}

function showScreenshot(dataUrl) {
  document.querySelectorAll(".missingScreenshot").forEach(elem => {
    elem.style.display = "none";
  });
  document.querySelectorAll(".screenshot").forEach(elem => {
    elem.style.display = "";
  });
  document.querySelectorAll(".screenshot > img").forEach(img => {
    img.src = dataUrl;
    img.style.display = "inline-block";
  });
}

function handleClick(e) {
  if (e.which !== 1) {
    return;
  }

  const exit = e.target.getAttribute("data-exit");
  if (exit) {
    portToBGScript.send({command: "leavingPageAction", exit});
  }

  if (e.target.matches(".screenshot > button")) {
    e.preventDefault();
    hideScreenshot();
    portToBGScript.send({command: "removeScreenshot"});
    return;
  }

  if (e.target.matches(".screenshot > img")) {
    e.preventDefault();
    portToBGScript.send({command: "showScreenshot"});
    return;
  }

  if (e.target.matches(".requestScreenshot")) {
    e.preventDefault();
    portToBGScript.send({command: "loadScreenshotUI"});
    return;
  }

  const action = e.target.getAttribute("data-action");
  if (action) {
    e.preventDefault();
    const message = {command: action};
    const forms = {
      "submitPerformanceFeedback": "performanceForm",
      "submitProblemReport": "problemReportForm",
    };
    if (Object.keys(forms).includes(action)) {
      const elem_id = forms[action];
      const form = document.querySelector(`#${elem_id}`);
      if (!form.checkValidity()) {
        // force the first invalid element to be highlighted.
        form.querySelector(":invalid").value = "";
        return;
      }
      for (const field of form.querySelectorAll("[name]")) {
        message[field.name] = field.value;
      }
      const feedbackCategories = [];
      for (const field of form.querySelectorAll("div > input:checked")) {
        feedbackCategories.push(field.value);
      }
      message.feedbackCategories = feedbackCategories;
      gState.feedbackCategories = feedbackCategories;
    }
    portToBGScript.send(message);
  }
}
