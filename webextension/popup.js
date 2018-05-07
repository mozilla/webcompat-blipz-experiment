/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

const gState = {};

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
      return port.postMessage(message);
    }
      console.trace();
      return Promise.reject("Background script has disconnected");
  }

  return {send};
}());

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", handleClick);

  for (const [value, msgId] of Object.entries({
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

  for (const [selector, msgId] of Object.entries({
    "[name=issueType]": "placeholderIssueType",
    "[name=issueDescription]": "placeholderDescription",
  })) {
    const input = document.querySelector(selector);
    input.placeholder = browser.i18n.getMessage(msgId);

    input.addEventListener("change", e => {
      const message = {};
      message[input.name] = input.value;
      portToBGScript.send(message);
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

function onMessage(update) {
  if (update === "closePopup") {
    window.close();
    return;
  }

  Object.assign(gState, update);

  if (update.slide) {
    document.documentElement.setAttribute("data-slide", update.slide);
    for (const section of document.querySelectorAll("section")) {
      if (section.id !== update.slide) {
        section.classList.remove("active");
      } else {
        section.classList.add("active");
      }
    }
  }

  for (const name of ["issueType", "issueDescription"]) {
    if (gState[name]) {
      document.querySelector(`[name=${name}]`).value = gState[name];
    }
  }

  if (gState.screenshot) {
    showScreenshot(gState.screenshot);
  } else {
    hideScreenshot();
  }
}

async function hideScreenshot() {
  await portToBGScript.send({type: "removeScreenshot"});

  const img = document.querySelector("img");
  if (img) {
    img.remove();
  }

  document.querySelector("#issueTakeScreenshot").style.display = "";
  document.querySelector("#issueRemoveScreenshot").style.display = "none";
}

function showScreenshot(dataUrl) {
  document.querySelector("#issueTakeScreenshot").style.display = "none";
  document.querySelector("#issueRemoveScreenshot").style.display = "";

  const img = document.createElement("img");
  img.src = dataUrl;
  document.querySelector("form").appendChild(img);

  img.addEventListener("click", function() {
    portToBGScript.send({type: "showScreenshot"});
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
    portToBGScript.send({type: "requestScreenshot"});
    return;
  }

  if (e.target.nodeName === "BUTTON") {
    e.preventDefault();
    const action = e.target.getAttribute("data-action");
    const message = {type: "action", action};
    if (action === "submit") {
      const form = document.querySelector("form");
      if (!form.checkValidity()) {
        // force the first invalid element to be highlighted.
        form.querySelector(":invalid").value = "";
        return;
      }
      for (const field of form.querySelectorAll("[name]")) {
        message[field.name] = field.value;
      }
    }
    portToBGScript.send(message);
  }
}
