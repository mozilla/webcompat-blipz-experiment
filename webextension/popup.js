/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals browser */

const gState = {};

const gIssueTypeLabels = {
  "": "placeholderIssueType",
  "desktopNotMobile": "issueLabelDesktopNotMobile",
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

  for (const [value, msgId] of Object.entries(gIssueTypeLabels)) {
    document.querySelector(`option[value="${value}"]`).innerText =
      browser.i18n.getMessage(msgId);
  }

  for (const [name, msgId] of Object.entries({
    "type": "placeholderIssueType",
    "description": "placeholderDescription",
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

  autosizeTextArea(document.querySelector("[name=description]"));
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

  if (update.uiVariant && gState.uiVariant !== update.uiVariant) {
    if (gState.uiVariant) {
      document.documentElement.classList.remove(gState.uiVariant);
    }
    document.documentElement.classList.add(update.uiVariant);
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

  for (const name of ["type", "description"]) {
    if (gState[name]) {
      document.querySelector(`[name=${name}]`).value = gState[name];
    }
  }

  if (gState.screenshot) {
    showScreenshot(gState.screenshot);
  } else {
    hideScreenshot();
  }

  if (gState.slide === "feedbackDetails") {
    const elem = document.querySelector("#feedbackDetails");

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
}

async function hideScreenshot() {
  document.querySelectorAll(".takeScreenshot").forEach(elem => {
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
  document.querySelectorAll(".takeScreenshot").forEach(elem => {
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

  if (e.target.matches(".takeScreenshot")) {
    e.preventDefault();
    portToBGScript.send({command: "requestScreenshot"});
    return;
  }

  const action = e.target.getAttribute("data-action");
  if (action) {
    e.preventDefault();
    const message = {command: action};
    if (action === "submit" || action === "showFeedbackDetails") {
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
