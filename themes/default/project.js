/*
 * rshow theme "default": project runtime. Zero dependencies.
 *
 * Markup: a <button type="button" class="btn" data-rshow-copy="<id>"> inside a
 * .copy-row, with a <span class="btn-label"> for its word and a sibling
 * <p class="copy-status" role="status" aria-live="polite"></p> for the
 * announcement. The entry itself is ordinary text in the page, so with
 * JavaScript off a reader can still select and copy it by hand.
 */
(function () {
  'use strict';

  var RESET_AFTER = 2500;
  var HELP = 'The entry is selected: press Command and C, or Control and C, to copy it.';

  function word(button) {
    return button.querySelector('.btn-label');
  }

  function status(button) {
    return button.parentNode ? button.parentNode.querySelector('.copy-status') : null;
  }

  function settle(button, message, label) {
    var name = word(button);
    var live = status(button);
    if (name) {
      name.textContent = label;
    }
    if (live) {
      live.textContent = message;
    }
    if (button.rshowReset) {
      window.clearTimeout(button.rshowReset);
    }
    button.rshowReset = window.setTimeout(function () {
      var back = word(button);
      var cleared = status(button);
      if (back) {
        back.textContent = 'Copy';
      }
      if (cleared) {
        cleared.textContent = '';
      }
      button.rshowReset = null;
    }, RESET_AFTER);
  }

  function select(element) {
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection) {
      return false;
    }
    var range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  // The clipboard API needs a secure context and a granted permission, so a page
  // opened from disk or a refused prompt falls back to selecting the text and
  // copying that selection with the older command.
  function bySelection(element) {
    if (!select(element)) {
      return false;
    }
    try {
      return document.execCommand('copy') === true;
    } catch (err) {
      return false;
    }
  }

  function report(button, ok) {
    if (ok) {
      settle(button, 'Copied', 'Copied');
      return;
    }
    settle(button, HELP, 'Copy');
  }

  function run(button) {
    var id = button.getAttribute('data-rshow-copy');
    var element = id ? document.getElementById(id) : null;
    if (!element) {
      return;
    }
    var clipboard = window.navigator.clipboard;
    if (clipboard && clipboard.writeText) {
      clipboard.writeText(element.textContent || '').then(function () {
        report(button, true);
      }, function () {
        report(button, bySelection(element));
      });
      return;
    }
    report(button, bySelection(element));
  }

  function start() {
    var buttons = document.querySelectorAll('[data-rshow-copy]');
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener('click', function () {
        run(this);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
