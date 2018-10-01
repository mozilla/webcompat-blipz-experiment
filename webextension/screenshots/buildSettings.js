"use strict";

window.buildSettings = {
  defaultSentryDsn: "",
  logLevel: "debug" || "warn",
  captureText: ("" === "true"),
  uploadBinary: ("" === "true"),
  pngToJpegCutoff: parseInt("" || 2500000, 10),
  maxImageHeight: parseInt("" || 10000, 10),
  maxImageWidth: parseInt("" || 10000, 10)
};
null;
