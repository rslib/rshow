"use strict";
(function () {
  var KEY = "rshow-mode";
  var root = document.documentElement;
  var mode = null;
  try { mode = window.localStorage.getItem(KEY); } catch (err) { mode = null; }
  if (mode === "light" || mode === "dark") root.dataset.mode = mode;
  else delete root.dataset.mode;
})();
