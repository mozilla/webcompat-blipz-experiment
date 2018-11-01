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
    "#initialPromptSentiment > h1.introduction": "titleInitialPromptIntroductionSentiment",
    "#initialPromptSentiment > p.introduction": "textInitialPromptIntroduction",
    "#initialPromptSentiment > a": "linkInitialPrompt",
    "#initialPromptSentiment > label": "labelNeverShowAgain",
    "#initialPromptSentiment > div > button.siteWorks": "promptWorks",
    "#initialPromptSentiment > div > button.siteBroken": "promptBroken",
    "#initialPromptSentiment > div > button.siteSlow": "promptSlow",
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
    "button[data-action='takeScreenshot']": "takeAScreenshot",
    "button[data-action='retakeScreenshot']": "retakeScreenshot",
    "#problemReport > form > label": "issueDescriptionLabel",
    "#problemReport > form > span": "placeholderIssueType",

    "#initialPromptV1 > h1": "titleInitialPromptV1",
    "#initialPromptV1 > p": "textInitialPromptV1",
    "#initialPromptV1 > a": "linkInitialPromptV1",
    "#initialPromptV1 > label": "labelNeverShowAgain",
    "#initialPromptV1 > button[data-action='yes']": "buttonYes",
    "#initialPromptV1 > button[data-action='no']": "buttonNo",
    "button[data-action='submitFeedbackV1']": "buttonSubmit",
    "#thankYouV1 > h1": "titleThankYouV1",
    "#thankYouFeedbackV1 > h1": "titleThankYouFeedbackV1",
    "#thankYouFeedbackV1 > p": "textThankYouFeedbackV1",
    "#thankYouFeedbackV1 > a": "labelLearnMoreV1",
    "#feedbackFormV1 > h2": "titleFeedbackFormV1",
    "#feedbackFormV1 > p": "textFeedbackFormV1",
    "#feedbackFormV1 > a": "linkShowFeedbackDetailsV1",
    "#feedbackDetailsV1 > h2": "titleFeedbackDetailsV1",
    "#feedbackDetailsV1 > p": "textFeedbackDetailsV1",
    "[data-detail='url'] > th": "detailLabel_url",
    "[data-detail='type'] > th": "detailLabel_type",
    "[data-detail='description'] > th": "detailLabel_description",
    "[data-detail='channel'] > th": "detailLabel_channel",
    "[data-detail='appVersion'] > th": "detailLabel_appVersion",
    "[data-detail='platform'] > th": "detailLabel_platform",
    "[data-detail='buildID'] > th": "detailLabel_buildID",
    "[data-detail='uiVariant'] > th": "detailLabel_experimentBranch",
  })) {
    const txt = browser.i18n.getMessage(msg);
    for (const node of document.querySelectorAll(selector)) {
      node.appendChild(document.createTextNode(txt));
    }
  }

  // text needing to linkify the privacy policy
  const link = document.createElement("a");
  link.href = browser.i18n.getMessage("privacyPolicyLink");
  link.innerText = browser.i18n.getMessage("privacyPolicyLinkText");
  for (const [selector, msg] of Object.entries({
    "#initialPrompt > p.privacyPolicy": "privacyPolicy",
    "#initialPromptSentiment > p.privacyPolicy": "privacyPolicy",
  })) {
    const split = browser.i18n.getMessage(msg).split("<PrivacyPolicyLink>");
    for (const node of document.querySelectorAll(selector)) {
      split.forEach((txt, index) => {
        if (index > 0) {
          node.appendChild(link.cloneNode(true));
        }
        node.appendChild(document.createTextNode(txt));
      });
    }
  }

  for (const [value, msgId] of Object.entries(gIssueTypeLabels)) {
    const input = document.querySelector(`input[value="${value}"]`);
    const msg = browser.i18n.getMessage(msgId);
    document.querySelector(`option[value="${value}"]`).innerText = msg; // v1
    document.querySelector(`label[for="${input.id}"]`).innerText = msg; // v2
  }

  document.querySelector(`option[value=""]`).innerText = // v1
    browser.i18n.getMessage("placeholderIssueTypeV1");

  for (const [name, msgId] of Object.entries({
    "description": "placeholderIssueDescription",
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

  document.querySelector("#problemReportForm").addEventListener("change", e => {
    const input = e.target;
    if (input.name === "type") {
      const message = {};
      message.type = gState.type = input.value;
      portToBGScript.send(message);
    }
  });

  for (const name of ["neverShowAgain"]) {
    document.querySelectorAll(`[name="${name}"]`).forEach(input => {
      input.addEventListener("change", e => {
        const message = {};
        message[input.name] = input.checked;
        portToBGScript.send(message);
      });
    });
  }
});

function autosizeTextArea(el) {
  const heightVarname = el.name + "Height";
  const userSetHeight = (gState.preferences || {})[heightVarname];
  function resize() {
    el.style.height = "auto";
    const popup = document.scrollingElement;
    const popupKidHeights = Array.map.call(null, popup.childNodes, n => n.clientHeight);
    const heightOfRest = popupKidHeights.reduce((a, c) => a + (c || 0), 0) - el.clientHeight;
    const maxHeight = 580 - heightOfRest; // ~580px seems to be the max-height of the popup
    el.style.height = Math.min(maxHeight, el.scrollHeight) + "px";
  }
  if (!el.getAttribute("data-ready")) {
    el.setAttribute("data-ready", 1);

    let heightOnDown;
    el.addEventListener("mousedown", () => {
      heightOnDown = el.clientHeight;
    });
    el.addEventListener("mouseup", () => {
      if (heightOnDown !== undefined &&
          heightOnDown !== el.clientHeight) {
        // user has manually resized the textarea; don't auto-size it anymore.
        el.removeEventListener("keydown", resize);
        el.removeEventListener("keypress", resize);
        el.removeEventListener("keyup", resize);
        el.removeEventListener("compositionstart", resize);
        el.removeEventListener("compositionupdate", resize);
        el.removeEventListener("compositionend", resize);

        const preferences = {};
        preferences[heightVarname] = el.clientHeight;
        portToBGScript.send({preferences});
      }
    });
    if (userSetHeight === undefined) {
      // If the user has manually sized the textarea, don't autosize.
      el.addEventListener("keydown", resize);
      el.addEventListener("keypress", resize);
      el.addEventListener("keyup", resize);
      el.addEventListener("compositionstart", resize);
      el.addEventListener("compositionupdate", resize);
      el.addEventListener("compositionend", resize);
    }
  }

  if (userSetHeight !== undefined) {
    // If the user has manually sized the textarea, just use that size.
    el.style.height = userSetHeight + "px";
    return;
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

  if (update.domain) {
    const toReplace = new RegExp(gState.domain || "<website>", "g");
    for (const selector of ["#initialPromptSentiment > h1"]) {
      const elem = document.querySelector(selector);
      if (elem) {
        elem.innerText = elem.innerText.replace(toReplace, update.domain);
      }
    }
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

    if (update.slide === "performanceFeedback") {
      if ("performanceDescription" in update) {
        document.querySelector(`#performanceFeedback textarea`).value = update.performanceDescription;
      }
    }
    if (update.slide === "problemReport") {
      if ("description" in update) {
        document.querySelector(`#problemReport #problemDescription`).value = update.description;
      }
      if ("type" in update) {
        document.querySelector(`#problemReport [value=${update.type}]`).checked = true;
      }
    }
    if (update.slide === "feedbackFormV1") {
      if ("description" in update) {
        document.querySelector(`#feedbackFormV1 textarea`).value = update.description;
      }
      if ("type" in update) {
        document.querySelector(`#feedbackFormV1 select`).value = update.type;
      }
    }
  }

  if (gState.screenshot) {
    showScreenshot(gState.screenshot);
  } else {
    hideScreenshot();
  }

  if (gState.slide === "feedbackDetailsV1") {
    const elem = document.querySelector("#feedbackDetailsV1");
    // Update each of the values in the table to match
    // what we will send if "submit" is clicked now.
    elem.querySelectorAll("[data-detail]").forEach(tr => {
      const detail = tr.getAttribute("data-detail");
      if (gState[detail]) {
        tr.style.display = "";
        let value = gState[detail];
        if (detail === "type") {
          value = browser.i18n.getMessage(gIssueTypeLabels[value]);
        }
        tr.querySelector("td").innerText = value;
      } else {
        tr.style.display = "none";
      }
    });
  }

  // Wait until we've received our state from the background page before
  // setting up autosizing for text-areas, because we need to know if the
  // user has manually set their size (stored in gState.preferences).
  document.querySelectorAll(`[name=description],
                             [name=problemDescription],
                             [name=performanceDescription],
                             [data-detail=description]`).forEach(ta => {
    autosizeTextArea(ta);
  });
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

  if (e.target.matches(".screenshot > img")) {
    e.preventDefault();
    portToBGScript.send({command: "showScreenshot"});
    return;
  }

  const action = e.target.getAttribute("data-action");
  if (action) {
    e.preventDefault();
    const message = {command: action};
    const forms = {
      "submitPerformanceFeedback": "#performanceForm",
      "submitProblemReport": "#problemReportForm",
      "submitFeedbackV1": "#feedbackFormV1 > form",
      "showFeedbackDetails": "#feedbackFormV1 > form",
      "takeScreenshot": "#feedbackFormV1 > form",
    };
    if (Object.keys(forms).includes(action)) {
      const form = document.querySelector(forms[action]);
      // if the form isn't on this slide, don't worry about it.
      if (gState.slide === form.closest("section").id) {
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
    }
    portToBGScript.send(message);
  }
}
