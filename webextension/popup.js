/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

let gState = {};

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", handleClick);
  browser.runtime.sendMessage({type: "popupOpened"});

  for (let [value, msgId] of Object.entries({
    "": "placeholderIssueType",
    "desktopNotMobile": "issueLabelDesktopNotMobile",
    "siteUnusable": "issueLabelSiteUnusable",
    "brokenDesign": "issueLabelBrokenDesign",
    "playbackFailure": "issueLabelPlaybackFailure",
    "other": "issueLabelOther",
  })) {
    document.querySelector(`option[value="${value}"]`).innerText =
      browser.i18n.getMessage(msgId);
  }

  for (let [selector, msgId] of Object.entries({
    "[name=issueType]": "placeholderIssueType",
    "[name=issueDescription]": "placeholderDescription",
  })) {
    let input = document.querySelector(selector);
    input.placeholder = browser.i18n.getMessage(msgId);

    input.addEventListener("change", e => {
      let message = {};
      message[input.name] = input.value;
      browser.runtime.sendMessage(message);
    });
  }

  autosizeTextArea(document.querySelector("[name=issueDescription]"));
});

function autosizeTextArea(el) {
  el.addEventListener("keydown", function() {
    requestAnimationFrame(() => {
      el.style.cssText = "height:auto; padding:0";
      el.style.cssText = "height:" + el.scrollHeight + "px";
    });
  });
}

window.onunload = function() {
  browser.runtime.sendMessage({type: "popupClosed"});
};

browser.runtime.onMessage.addListener(update => {
  if (update === "closePopup") {
    window.close();
    return;
  }

  Object.assign(gState, update);

  if (update.slide) {
    document.documentElement.setAttribute("data-slide", update.slide);
    for (let section of document.querySelectorAll("section")) {
      if (section.id !== update.slide) {
        section.classList.remove("active");
      } else {
        section.classList.add("active");
      }
    }
  }

  for (let name of ["issueType", "issueDescription"]) {
    if (gState[name]) {
      document.querySelector(`[name=${name}]`).value = gState[name];
    }
  }

  if (gState.screenshot) {
    showScreenshot(gState.screenshot);
  } else {
    hideScreenshot();
  }
});

async function hideScreenshot() {
  await browser.runtime.sendMessage({type: "removeScreenshot"});

  let img = document.querySelector("img");
  if (img) {
    img.remove();
  }

  document.querySelector("#issueTakeScreenshot").style.display = "";
  document.querySelector("#issueRemoveScreenshot").style.display = "none";
}

function showScreenshot(dataUrl) {
  document.querySelector("#issueTakeScreenshot").style.display = "none";
  document.querySelector("#issueRemoveScreenshot").style.display = "";

  let img = document.createElement("img");
  img.src = dataUrl;
  document.querySelector("form").appendChild(img);

  img.addEventListener("click", function() {
    browser.runtime.sendMessage({type: "showScreenshot"});
  });
}

function handleClick(e) {
  if (e.which !== 1) {
    return;
  }

  if (e.target.id === "issueRemoveScreenshot") {
    e.preventDefault();
    hideScreenshot();
    return;
  }

  if (e.target.id === "issueTakeScreenshot") {
    e.preventDefault();
    browser.runtime.sendMessage({type: "requestScreenshot"});
    return;
  }

  if (e.target.nodeName === "BUTTON") {
    e.preventDefault();
    let action = e.target.getAttribute("data-action");
    let message = {type: "action", action};
    if (action === "submit") {
      let form = document.querySelector("form");
      if (!form.checkValidity()) {
        // force the first invalid element to be highlighted.
        form.querySelector(":invalid").value = "";
        return;
      }
      for (let field of form.querySelectorAll("[name]")) {
        message[field.name] = field.value;
      }
    }
    browser.runtime.sendMessage(message);
  }
}
