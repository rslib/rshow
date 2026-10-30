/*
 * rshow theme "default": mode. Zero dependencies, no build step.
 *
 * One theme, two modes, system by default. This file owns the reader's choice:
 *
 *   localStorage["rshow-mode"] = "light" | "dark" | "system"  (absence = system)
 *   <html data-mode="light">   force light
 *   <html data-mode="dark">    force dark
 *   <html>                     follow prefers-color-scheme
 *
 * It runs from <head>, synchronously, before the body paints, so a page never
 * flashes white on the way to dark. Everything that touches storage sits in a
 * try/catch: private windows and file:// refuse localStorage and the page still
 * works, following the system.
 *
 * The toggle. A page may place its own <button data-rshow-mode-toggle>; if it
 * does not, this file mounts a small fixed button in the bottom right corner of
 * the viewport, 16px in from the edge and outside whatever a notch or a home
 * indicator takes (env(safe-area-inset-*)), so it holds still on a long page.
 * A report page has a note column down its right side, and at 1056px and wider
 * the corner button would sit on top of it: there the button moves to the
 * bottom of the contents column instead, which sticks and is never covered.
 * Either way the button is a real <button> that says the current mode in words,
 * has an aria-label, a 44px target, the Carbon ghost look and no place in
 * print.
 *
 * API: window.rshowMode = { get, set, cycle }. A deck reads the same key, so a
 * choice made on one rshow document holds on the next: see deck.js, key "t".
 * A change also fires a "rshowmodechange" event on document, which is how the
 * theme preview re-reads its token values.
 */
(function () {
  'use strict';

  var KEY = 'rshow-mode';
  var MODES = ['system', 'light', 'dark'];
  var WORDS = { system: 'System', light: 'Light', dark: 'Dark' };
  var LABELS = {
    system: 'Colour mode: System, following this device. Activate to choose light.',
    light: 'Colour mode: Light. Activate to choose dark.',
    dark: 'Colour mode: Dark. Activate to follow this device.'
  };

  function normalize(value) {
    return MODES.indexOf(value) === -1 ? 'system' : value;
  }

  function get() {
    try {
      return normalize(window.localStorage.getItem(KEY));
    } catch (err) {
      return 'system';
    }
  }

  function paint(mode) {
    var root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-mode');
    } else {
      root.setAttribute('data-mode', mode);
    }
  }

  function announce(mode) {
    try {
      document.dispatchEvent(new window.CustomEvent('rshowmodechange', {
        detail: { mode: mode }
      }));
    } catch (err) {
      // A browser without CustomEvent keeps the attribute and loses the event.
    }
  }

  function set(mode) {
    var next = normalize(mode);
    paint(next);
    try {
      if (next === 'system') {
        window.localStorage.removeItem(KEY);
      } else {
        window.localStorage.setItem(KEY, next);
      }
    } catch (err) {
      // No storage: the mode still holds for this document.
    }
    sync();
    announce(next);
    return next;
  }

  function cycle() {
    return set(MODES[(MODES.indexOf(get()) + 1) % MODES.length]);
  }

  // ---------------------------------------------------------------- paint --

  // Before anything else, so the first frame is the right ground.
  paint(get());

  var STYLE = [
    '.rshow-mode-toggle{',
    'min-width:44px;min-height:44px;padding:0 14px;',
    'display:inline-flex;align-items:center;justify-content:center;',
    'font-family:var(--font-sans,system-ui,sans-serif);font-size:14px;line-height:1;',
    'letter-spacing:0;color:var(--muted,#525252);background:transparent;',
    'border:1px solid var(--border-subtle,#e0e0e0);border-radius:var(--radius,0);',
    'cursor:pointer;-webkit-appearance:none;appearance:none;',
    'transition:background-color 110ms ease,color 110ms ease,border-color 110ms ease}',
    '.rshow-mode-toggle:hover{background:var(--layer-01,#f4f4f4);',
    'border-color:var(--border-strong,#8d8d8d);color:var(--fg,#161616)}',
    '.rshow-mode-toggle:focus-visible{outline:2px solid var(--accent,#0f62fe);',
    'outline-offset:-2px}',
    '.rshow-mode-toggle--fixed{position:fixed;z-index:20;',
    'right:16px;bottom:16px;',
    'right:max(16px,env(safe-area-inset-right,16px));',
    'bottom:max(16px,env(safe-area-inset-bottom,16px));',
    'background:var(--bg,#ffffff)}',
    '.rshow-mode-toggle--toc{margin:var(--space-06,24px) 0 0}',
    '@media print{.rshow-mode-toggle,.rshow-mode-toggle--fixed,',
    '.rshow-mode-toggle--toc{display:none}}'
  ].join('');

  var button = null;

  function sync() {
    if (!button) {
      return;
    }
    var mode = get();
    button.textContent = WORDS[mode];
    button.setAttribute('aria-label', LABELS[mode]);
    button.setAttribute('title', 'Colour mode: ' + WORDS[mode] + ' (t in a deck)');
  }

  function mount() {
    var style = document.createElement('style');
    style.appendChild(document.createTextNode(STYLE));
    document.head.appendChild(style);

    var host = document.querySelector('[data-rshow-mode-toggle]');
    var fixed = false;
    if (host) {
      if (host.tagName === 'BUTTON') {
        button = host;
      } else {
        button = document.createElement('button');
        button.type = 'button';
        host.appendChild(button);
      }
    } else {
      button = document.createElement('button');
      button.type = 'button';
      fixed = true;
      document.body.appendChild(button);
    }

    button.type = 'button';
    button.classList.add('rshow-mode-toggle');
    if (fixed) {
      button.classList.add('rshow-mode-toggle--fixed');
    }
    button.addEventListener('click', function () {
      cycle();
    });
    sync();
    if (fixed) {
      place();
      window.addEventListener('resize', queuePlace);
      document.addEventListener('rshowmodechange', place);
    }
  }

  // ---------------------------------------------------------- placement --

  // This file mounts the button, so it owns where it goes. The corner rule is
  // position: fixed, 16px from the right and bottom edge of the viewport, and
  // the only thing it can land on is the note column of a report. The test is
  // geometry, not a media query alone: if the corner box and the note column
  // share any width at a size where a note column exists, the button goes to
  // the bottom of the contents instead. It is measured from the corner, never
  // from where the button happens to be, so the two places cannot flip.

  var CORNER = 16;
  var queued = null;

  function cornerOverNotes() {
    var notes = document.querySelector('.report .notes');
    if (!notes) {
      return false;
    }
    if (window.matchMedia && !window.matchMedia('(min-width: 1056px)').matches) {
      return false;
    }
    var column = notes.getBoundingClientRect();
    if (column.width === 0 || column.height === 0) {
      return false;
    }
    var width = button.getBoundingClientRect().width;
    var right = window.innerWidth - CORNER;
    var left = right - width - 4;
    return left < column.right && column.left < right;
  }

  function place() {
    if (!button) {
      return;
    }
    var toc = document.querySelector('.report nav.toc');
    if (toc && cornerOverNotes()) {
      if (button.parentNode !== toc) {
        toc.appendChild(button);
      }
      button.classList.add('rshow-mode-toggle--toc');
      button.classList.remove('rshow-mode-toggle--fixed');
      return;
    }
    if (button.parentNode !== document.body) {
      document.body.appendChild(button);
    }
    button.classList.add('rshow-mode-toggle--fixed');
    button.classList.remove('rshow-mode-toggle--toc');
  }

  function queuePlace() {
    if (queued !== null) {
      window.clearTimeout(queued);
    }
    queued = window.setTimeout(function () {
      queued = null;
      place();
    }, 120);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }

  window.rshowMode = { get: get, set: set, cycle: cycle };
}());
