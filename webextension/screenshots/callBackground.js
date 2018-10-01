/* globals log, selectorLoader */

"use strict";

this.portToBGScript = (function() {
  let port;

  function connect() {
    port = browser.runtime.connect({name: "screenshotsPort"});
    port.onDisconnect.addListener(e => {
      port = undefined;
      unloadSelector();
    });
  }

  connect();

  async function send(message) {
    if (port) {
      return port.postMessage(message);
    }
    console.trace();
    unloadSelector();
    return Promise.reject("Background script has disconnected");
  }

  return {send};
}());

this.unloadSelector = () => {
  selectorLoader.unloadModules();
  delete this.portToBGScript;
  delete this.callBackground;
  delete this.unloadSelector;
};

this.callBackground = function callBackground(name, ...args) {
  return portToBGScript.send({name, args});
};

// Ensure that the user can immediately start typing, which can
// be broken if they press the hotkey to open the Blipz popup,
// as the document screenshots is now loading on won't have focus.
if (!document.activeElement) {
  document.documentElement.focus();
}

null;
