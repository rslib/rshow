/*
 * rshow theme "default": sketch viewer. Three pinned dependencies, loaded on
 * demand from jsDelivr: React, ReactDOM and Excalidraw, all at exact versions.
 *
 *   react@18.3.1                        umd/react.production.min.js
 *   react-dom@18.3.1                    umd/react-dom.production.min.js
 *   @excalidraw/excalidraw@0.17.6       dist/excalidraw.production.min.js
 *
 * 0.17.6 is the last Excalidraw that ships a UMD bundle, so it is the last one
 * a page can use without a bundler. Its fonts and locales are fetched from the
 * same pinned folder through window.EXCALIDRAW_ASSET_PATH, which has to be set
 * before the bundle runs.
 *
 * Markup: <div class="sketch" data-src="drawing.excalidraw" data-store="sketch-main"></div>
 *
 *   data-src    the .excalidraw file to read, relative to the page
 *   data-store  the artifact store key that holds a saved copy, optional
 *
 * View mode is the default: read only, fitted to the drawing, pan and zoom. The
 * bar over the canvas carries Edit, which opens the editor, Save, which writes
 * the scene to the store, and Download, which writes a .excalidraw file that can
 * be committed and published as a new version.
 *
 * The store. `_data/<key>` is the per artifact store and the only network call a
 * page may make. The artifact root is the first path segment of
 * location.pathname, so the store sits at /<artifact>/_data/<key>; the copy
 * relative to the page, ../_data/<key> from example/, is tried second, which is
 * the one a local preview answers. A saved scene wins over the file when its
 * savedAt is later than the file's Last-Modified, and the bar says which one the
 * reader is looking at. A public viewer cannot write, so 401 and 403 say "Sign
 * in to save", 404 says "Saving works once published" and 413 points at
 * Download.
 *
 * Ink. The drawing is authored on paper, in Carbon white values. In dark mode
 * the ink inverts for the screen and inverts back on save or download, so a
 * committed file keeps one palette and the store holds what the reader drew.
 */
(function () {
  'use strict';

  var LIB = {
    react: 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
    reactDom: 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
    excalidraw: 'https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.17.6/dist/excalidraw.production.min.js'
  };
  var ASSETS = 'https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.17.6/dist/';
  var STORE_LIMIT = 64 * 1024;

  // Authored ink and its dark twin. Every value is a token from tokens.css:
  // --fg, --muted, --border-strong, --layer-01, --bg, --accent, and their g100
  // counterparts. The inverse of this table is what save writes back.
  var DARK_INK = {
    '#161616': '#f4f4f4',
    '#525252': '#c6c6c6',
    '#8d8d8d': '#6f6f6f',
    '#f4f4f4': '#262626',
    '#ffffff': '#161616',
    '#0f62fe': '#78a9ff'
  };
  var LIGHT_INK = {};
  (function () {
    var from;
    for (from in DARK_INK) {
      if (Object.prototype.hasOwnProperty.call(DARK_INK, from)) {
        LIGHT_INK[DARK_INK[from]] = from;
      }
    }
  }());

  var WORDS = {
    loading: 'Loading the sketch.',
    noLoad: 'The sketch did not load. The file is still here: ',
    noLibs: 'The sketch needs React and Excalidraw from the CDN, and they did not arrive. The file is still here: ',
    saving: 'Saving the sketch.',
    saved: 'Saved at ',
    tooBig: 'Too big to save here; use Download and publish with rshow',
    offline: 'Could not reach the store, so nothing was saved',
    shown: 'Showing the saved sketch from '
  };

  // ------------------------------------------------------------- loading ---

  var bundle = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error(src));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function loadBundle() {
    if (bundle !== null) {
      return bundle;
    }
    // The asset path has to be in place before the bundle evaluates, because it
    // is read at load time.
    window.EXCALIDRAW_ASSET_PATH = ASSETS;
    bundle = loadScript(LIB.react)
      .then(function () {
        return loadScript(LIB.reactDom);
      })
      .then(function () {
        return loadScript(LIB.excalidraw);
      })
      .then(function () {
        if (!window.React || !window.ReactDOM || !window.ExcalidrawLib) {
          throw new Error(LIB.excalidraw);
        }
        return window.ExcalidrawLib;
      });
    return bundle;
  }

  // ---------------------------------------------------------------- store ---

  // The page sits somewhere below the artifact root, and the root is the first
  // path segment. From there, `_data/<key>`; from the page's own folder, one
  // `..` per level. Both are tried: the root one is what a published artifact
  // answers, the relative one is what a preview of this folder answers.
  function storeUrls(key) {
    var parts = window.location.pathname.split('/');
    var dirs = [];
    var i;
    for (i = 0; i < parts.length; i += 1) {
      if (parts[i] !== '') {
        dirs.push(parts[i]);
      }
    }
    if (dirs.length > 0 && /\.[a-z0-9]{1,5}$/i.test(dirs[dirs.length - 1])) {
      dirs.pop();
    }
    var leaf = '_data/' + encodeURIComponent(key);
    var urls = [];
    if (dirs.length > 0) {
      urls.push('/' + dirs[0] + '/' + leaf);
    }
    var up = '';
    for (i = 0; i < dirs.length; i += 1) {
      up += '../';
    }
    urls.push(up + leaf);
    return urls;
  }

  function readStore(urls) {
    var index = 0;
    function step() {
      if (index >= urls.length) {
        return Promise.resolve(null);
      }
      var url = urls[index];
      index += 1;
      return window.fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' }
      }).then(function (reply) {
        if (!reply.ok) {
          return step();
        }
        return reply.json().then(function (body) {
          if (body && body.value && typeof body.value === 'object') {
            return body.value;
          }
          return step();
        }, step);
      }, step);
    }
    return step();
  }

  function putStore(urls, body) {
    var index = 0;
    function step() {
      var url = urls[index];
      index += 1;
      return window.fetch(url, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: body
      }).then(function (reply) {
        if (reply.status === 404 && index < urls.length) {
          return step();
        }
        return { status: reply.status, ok: reply.ok };
      }, function () {
        return { status: 0, ok: false };
      });
    }
    return step();
  }

  function saveWords(status) {
    if (status >= 200 && status < 300) {
      return WORDS.saved;
    }
    if (status === 401 || status === 403) {
      return 'Sign in to save';
    }
    if (status === 404) {
      return 'Saving works once published';
    }
    if (status === 413) {
      return WORDS.tooBig;
    }
    if (status === 0) {
      return WORDS.offline;
    }
    return 'Could not save: HTTP ' + status;
  }

  // ----------------------------------------------------------------- ink ---

  function retint(elements, table) {
    if (!table) {
      return elements;
    }
    var out = [];
    var i;
    for (i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      var stroke = mapColor(table, element.strokeColor);
      var fill = mapColor(table, element.backgroundColor);
      if (stroke === element.strokeColor && fill === element.backgroundColor) {
        out.push(element);
        continue;
      }
      var next = {};
      var key;
      for (key in element) {
        if (Object.prototype.hasOwnProperty.call(element, key)) {
          next[key] = element[key];
        }
      }
      next.strokeColor = stroke;
      next.backgroundColor = fill;
      out.push(next);
    }
    return out;
  }

  function mapColor(table, value) {
    var key = typeof value === 'string' ? value.toLowerCase() : '';
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : value;
  }

  // ---------------------------------------------------------------- words ---

  function token(name, fallback) {
    var value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    value = (value || '').replace(/^\s+|\s+$/g, '');
    return value === '' ? fallback : value;
  }

  // mode.js paints data-mode and leaves it off for "follow the system", so the
  // attribute is the first answer and the media query is the second.
  function mode() {
    var painted = document.documentElement.getAttribute('data-mode');
    if (painted === 'dark' || painted === 'light') {
      return painted;
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  // The drawing decides the height of its own frame: a wide, short diagram gets
  // a short frame instead of a page of air, and the fit below then fills it.
  function bounds(elements) {
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    var i;
    for (i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      if (!element || element.isDeleted === true) {
        continue;
      }
      if (typeof element.width !== 'number' || typeof element.height !== 'number') {
        continue;
      }
      left = Math.min(left, element.x);
      top = Math.min(top, element.y);
      right = Math.max(right, element.x + element.width);
      bottom = Math.max(bottom, element.y + element.height);
    }
    if (!isFinite(left) || !isFinite(right)) {
      return null;
    }
    return {
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  function dateWords(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) {
      return 'an earlier visit';
    }
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(when);
    } catch (err) {
      return when.toISOString();
    }
  }

  // ---------------------------------------------------------------- mount ---

  function lane(host, words, href) {
    host.textContent = '';
    var box = document.createElement('div');
    box.className = 'sketch-lane';
    box.appendChild(document.createTextNode(words));
    if (href) {
      var link = document.createElement('a');
      link.href = href;
      link.textContent = href;
      box.appendChild(link);
    }
    host.appendChild(box);
  }

  function fail(host, words) {
    var src = host.getAttribute('data-src') || '';
    lane(host, words, src);
  }

  function button(host, label) {
    var element = document.createElement('button');
    element.type = 'button';
    element.className = 'sketch-btn';
    element.textContent = label;
    host.appendChild(element);
    return element;
  }

  function mount(host, lib) {
    var React = window.React;
    var ReactDOM = window.ReactDOM;
    var h = React.createElement;
    var Excalidraw = lib.Excalidraw;

    var src = host.getAttribute('data-src') || '';
    var store = (host.getAttribute('data-store') || '').replace(/^\s+|\s+$/g, '');
    var urls = store === '' ? [] : storeUrls(store);

    var scene = null;
    var base = '';
    var shown = mode();
    var editing = false;
    var api = null;
    var root = null;

    host.textContent = '';

    var bar = document.createElement('div');
    bar.className = 'sketch-bar';
    var editButton = button(bar, 'Edit');
    var saveButton = button(bar, 'Save');
    var downloadButton = button(bar, 'Download');
    var status = document.createElement('p');
    status.className = 'sketch-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = WORDS.loading;
    bar.appendChild(status);

    saveButton.classList.add('sketch-btn--primary');
    saveButton.disabled = true;
    editButton.setAttribute('aria-pressed', 'false');

    var stage = document.createElement('div');
    stage.className = 'sketch-stage';

    host.appendChild(bar);
    host.appendChild(stage);

    function paper() {
      return token('--bg', '#ffffff');
    }

    function initialData() {
      var elements = (scene && scene.elements) || [];
      return {
        elements: retint(elements, shown === 'dark' ? DARK_INK : null),
        appState: {
          viewBackgroundColor: paper(),
          currentItemFontFamily: 2
        },
        scrollToContent: true,
        files: (scene && scene.files) || {}
      };
    }

    var initial = initialData();

    function attach(next) {
      api = next || null;
      if (api) {
        // Let the editor draw once before measuring it: the canvas has no
        // elements and no width on the frame the ref fires.
        window.setTimeout(settle, 120);
      }
    }

    function settle() {
      shape();
      window.requestAnimationFrame(fit);
    }

    function element() {
      return h(Excalidraw, {
        initialData: initial,
        theme: shown,
        viewModeEnabled: !editing,
        zenModeEnabled: false,
        gridModeEnabled: false,
        UIOptions: {
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveAsImage: false,
            saveToActiveFile: false,
            toggleTheme: false
          }
        },
        // 0.17 hands its API to a prop, not to a ref: the editor is
        // memo(ExcalidrawBase) and takes excalidrawAPI as a callback.
        excalidrawAPI: attach
      });
    }

    window.__dbg = { shownAtMount: shown, media: window.matchMedia('(prefers-color-scheme: dark)').matches, attr: document.documentElement.getAttribute('data-mode'), initialStrokes: (initial.elements || []).map(function (e) { return e.strokeColor; }), paper: initial.appState.viewBackgroundColor };

    function paint() {
      if (root === null && typeof ReactDOM.createRoot === 'function') {
        stage.textContent = '';
        root = ReactDOM.createRoot(stage);
        root.render(element());
        return;
      }
      if (root !== null) {
        root.render(element());
        return;
      }
      ReactDOM.render(element(), stage);
    }

    function fit() {
      if (!api) {
        return;
      }
      try {
        api.scrollToContent(api.getSceneElements(), { fitToContent: true });
      } catch (err) {
        // An older build without scrollToContent keeps the view it had.
      }
    }

    // Height follows the drawing's own proportions, once the canvas has a width
    // to measure against: a wide, short figure gets a short frame.
    function shape() {
      if (!api) {
        return;
      }
      var box = bounds(api.getSceneElements());
      var width = stage.clientWidth;
      if (!box || width === 0) {
        return;
      }
      var height = Math.round(width * (box.height / box.width + 0.08));
      stage.style.height = Math.max(220, Math.min(620, height)) + 'px';
    }

    // A mode change repaints the tool chrome and carries the ink with it: the
    // elements on screen are always in the palette of the mode on screen.
    function repaint() {
      var next = mode();
      if (next === shown) {
        return;
      }
      var table = next === 'dark' ? DARK_INK : LIGHT_INK;
      shown = next;
      paint();
      if (!api) {
        return;
      }
      try {
        api.updateScene({
          elements: retint(api.getSceneElements(), table),
          appState: { viewBackgroundColor: paper() }
        });
      } catch (err) {
        // Nothing to do: the chrome is right and the ink keeps its palette.
      }
    }

    function fileNow() {
      var elements = api ? api.getSceneElements() : ((scene && scene.elements) || []);
      if (shown === 'dark') {
        elements = retint(elements, LIGHT_INK);
      }
      return {
        type: 'excalidraw',
        version: 2,
        source: window.location.href,
        elements: elements,
        appState: { gridSize: null },
        files: api && api.getFiles ? api.getFiles() : {}
      };
    }

    function save() {
      if (!api || urls.length === 0) {
        return;
      }
      var body = JSON.stringify({
        value: {
          scene: fileNow(),
          savedAt: new Date().toISOString(),
          base: base
        }
      });
      if (body.length > STORE_LIMIT) {
        status.textContent = WORDS.tooBig;
        return;
      }
      status.textContent = WORDS.saving;
      saveButton.disabled = true;
      putStore(urls, body).then(function (result) {
        saveButton.disabled = false;
        status.textContent = result.ok
          ? WORDS.saved + dateWords(new Date().toISOString())
          : saveWords(result.status);
      }, function () {
        saveButton.disabled = false;
        status.textContent = WORDS.offline;
      });
    }

    function download() {
      var name = src.split('/').pop();
      if (!name || name === '') {
        name = 'sketch.excalidraw';
      }
      var blob = new Blob([JSON.stringify(fileNow(), null, 2)], {
        type: 'application/vnd.excalidraw+json'
      });
      var href = window.URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = href;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(function () {
        window.URL.revokeObjectURL(href);
      }, 4000);
    }

    editButton.addEventListener('click', function () {
      editing = !editing;
      editButton.textContent = editing ? 'Done' : 'Edit';
      editButton.setAttribute('aria-pressed', editing ? 'true' : 'false');
      saveButton.disabled = !editing;
      status.textContent = editing
        ? 'Edit mode: draw, then Save, or Download to publish a new version.'
        : '';
      paint();
      if (!editing) {
        window.requestAnimationFrame(settle);
      }
    });

    saveButton.addEventListener('click', save);
    downloadButton.addEventListener('click', download);

    document.addEventListener('rshowmodechange', repaint);
    if (window.matchMedia) {
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', repaint);
      } else if (typeof media.addListener === 'function') {
        media.addListener(repaint);
      }
    }

    // ------------------------------------------------------------- read it --

    function readFile() {
      return window.fetch(src, { credentials: 'same-origin' }).then(function (reply) {
        if (!reply.ok) {
          throw new Error(src + ' answered HTTP ' + reply.status);
        }
        base = reply.headers.get('last-modified') || '';
        return reply.text();
      }).then(function (text) {
        var file = JSON.parse(text);
        if (!file || !Array.isArray(file.elements)) {
          throw new Error(src + ' is not an Excalidraw scene');
        }
        return file;
      });
    }

    // A scene saved in the store wins over the file only when it is newer than
    // the file the artifact published, and the bar says so.
    function choose(file) {
      if (urls.length === 0) {
        return Promise.resolve({ scene: file, words: '' });
      }
      return readStore(urls).then(function (stored) {
        if (!stored || !stored.scene || !Array.isArray(stored.scene.elements)) {
          return { scene: file, words: '' };
        }
        var saved = Date.parse(stored.savedAt);
        var published = Date.parse(base);
        if (!isNaN(saved) && (isNaN(published) || saved > published)) {
          return { scene: stored.scene, words: WORDS.shown + dateWords(stored.savedAt) };
        }
        return { scene: file, words: '' };
      }, function () {
        return { scene: file, words: '' };
      });
    }

    readFile().then(choose).then(function (result) {
      scene = result.scene;
      initial = initialData();
      window.__dbg3 = { strokes: initial.elements.map(function (e) { return e.strokeColor; }).slice(0, 3), paper: initial.appState.viewBackgroundColor, shown: shown };
      status.textContent = result.words;
      paint();
    }, function (err) {
      status.textContent = '';
      lane(stage, WORDS.noLoad, src);
      if (window.console && window.console.warn) {
        window.console.warn('sketch: ' + (err && err.message ? err.message : err));
      }
    });
  }

  function start() {
    var hosts = document.querySelectorAll('.sketch[data-src]');
    if (hosts.length === 0) {
      return;
    }
    loadBundle().then(function (lib) {
      var i;
      for (i = 0; i < hosts.length; i += 1) {
        mount(hosts[i], lib);
      }
    }, function () {
      var i;
      for (i = 0; i < hosts.length; i += 1) {
        fail(hosts[i], WORDS.noLibs);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
