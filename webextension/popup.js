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
    document.querySelector(selector).placeholder =
      browser.i18n.getMessage(msgId);
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

browser.runtime.onMessage.addListener(newState => {
  if (newState === "closePopup") {
    window.close();
    return;
  }

  gState = newState;
  let { activeSlide } = newState;
  document.documentElement.setAttribute("data-slide", activeSlide);
  for (let section of document.querySelectorAll("section")) {
    if (section.id !== activeSlide) {
      section.classList.remove("active");
    } else {
      section.classList.add("active");
    }
  }
});

function getScreenshot() {
  return new Promise((resolve, reject) => {
    try {
      const XHTMLNS = "http://www.w3.org/1999/xhtml";
      let x = document.documentElement.scrollLeft,
          y = document.documentElement.scrollTop,
          width = window.innerWidth,
          height = window.innerHeight,
          canvas = document.createElementNS(XHTMLNS, "canvas"),
          ctx = canvas.getContext("2d"),
          dpi = window.devicePixelRatio;

      // Take screenshots in the DPI of the screen (ie retina displays).
      canvas.width = width * dpi;
      canvas.height = height * dpi;
      ctx.scale(dpi, dpi);

      ctx.drawWindow(window, x, y, width, height, "#fff");
      let url = canvas.toDataURL("image/png");
      fetch(url).then(res => res.blob()).then(resolve).catch(reject);
    } catch (ex) {
      // drawWindow can fail depending on memory or surface size.
      reject(ex);
    }
  });
}

function handleClick(e) {
  if (e.which !== 1) {
    return;
  }

  if (e.target.id === "issueScreenshot") {
    e.preventDefault();
    getScreenshot().then(screenshot => {
      browser.runtime.sendMessage({type: "metadata", screenshot});
    }).catch(ex => {
      console.error(browser.i18n.getMessage("errorScreenshotFail"), ex);
    });
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
