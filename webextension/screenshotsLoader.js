// Note this is a customized form of Screenshots selectorLoader.js
// Aside from ES6 linting fixes, the only modifications to the files
// in screenshots/ are some rules appended to inlineSelectionCss.js
// to hide unnecessary UI elements.

"use strict";

// eslint-disable-next-line no-var
var global = this;

this.clipboard = (function() {
  const exports = {};

  exports.copy = function(url) {
    // Stop Screenshots from handling the screenshot any further.
    return Promise.reject({noReport: true});
  };

  return exports;
})();

this.selectorLoader = (function() {
  const exports = {};

  const selectorScripts = [
    "screenshots/buildSettings.js",
    "screenshots/log.js",
    "screenshots/catcher.js",
    "screenshots/assertIsBlankDocument.js",
    "screenshots/assertIsTrusted.js",
    "screenshots/blobConverters.js",
    "screenshotsLoader.js",
    "screenshots/callBackground.js",
    "screenshots/util.js",
    "screenshots/makeUuid.js",
    "screenshots/selection.js",
    "screenshots/shot.js",
    "screenshots/randomString.js",
    "screenshots/domainFromUrl.js",
    "screenshots/inlineSelectionCss.js",
    "screenshots/documentMetadata.js",
    "screenshots/ui.js",
    "screenshots/shooter.js",
    "screenshots/uicontrol.js",
  ];

  const loadingTabs = new Set();

  let actualScreenshotsFrame;

  exports.loadModules = function(tabId) {
    loadingTabs.add(tabId);
    const promise = executeModules(tabId, selectorScripts);
    return promise.then((result) => {
      loadingTabs.delete(tabId);
      return result;
    }, (error) => {
      loadingTabs.delete(tabId);
      throw error;
    });
  };

  function executeModules(tabId, scripts) {
    let lastPromise = Promise.resolve(null);
    scripts.forEach((file) => {
      lastPromise = lastPromise.then(() => {
        return browser.tabs.executeScript(tabId, {
          file,
          runAt: "document_start",
        }).catch((error) => {
          console.error("error in script:", file, error);
          error.scriptName = file;
          throw error;
        });
      });
    });
    return lastPromise.catch((error) => {
      exports.unloadIfLoaded(tabId);
      throw error;
    });
}
  exports.unloadIfLoaded = function(tabId) {
    return browser.tabs.executeScript(tabId, {
      code: "this.selectorLoader && this.selectorLoader.unloadModules()",
      runAt: "document_start",
    }).then(result => {
      return result && result[0];
    });
  };

  exports.unloadModules = function() {
    const moduleNames = selectorScripts.map((filename) =>
      filename.replace(/^.*\//, "").replace(/\.js$/, ""));
    moduleNames.reverse();
    for (const moduleName of moduleNames) {
      const moduleObj = global[moduleName];
      if (moduleObj && moduleObj.unload) {
        try {
          moduleObj.unload();
        } catch (e) {
          // ignore (watchFunction handles it)
        }
      }
      delete global[moduleName];
    }

    // Now re-show the real screenshots UI, if we hid it earlier.
    if (actualScreenshotsFrame) {
      actualScreenshotsFrame.style.display = "";
      actualScreenshotsFrame = undefined;
    }
    return true;
  };

  return exports;
})();
null;
