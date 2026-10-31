/*
 * rshow theme "default": mockup runtime. Zero dependencies.
 *
 * Markup
 *
 *   <main class="mockup" data-skin="wire" data-store="../_data/mockup-comments">
 *     <section class="artboard" id="gallery" data-frame="browser"
 *              data-title="Gallery" data-url="art.example.com/admin"
 *              data-states="empty,loading,error" data-w="1280" data-h="800">
 *       ...content in the skin's classes...
 *     </section>
 *   </main>
 *
 * A section.artboard holds the screen content directly. This file wraps it in
 * a frame, moves the content into .mk-screen and adds the title above it.
 *
 * Attributes on an artboard
 *
 *   id                 the target of a flow link and the URL hash
 *   data-title         the name above the canvas, and the default window title
 *   data-frame         browser | phone | tablet | desktop | custom | bare |
 *                      terminal
 *   data-os            mac | windows | linux, for data-frame="desktop"
 *   data-url           the address bar text of a browser frame
 *   data-status        the status bar text of a phone or a tablet frame
 *   data-window-title  the window title, when it is not data-title
 *   data-w, data-h     the screen size in CSS pixels
 *   data-states        a comma separated list, builds a tab row under the title
 *   data-drag          the height of the drag region of a custom frame
 *   data-controls      draw the window control overlay area of a custom frame
 *   data-flush         no default padding inside the screen
 *
 * Skins
 *
 *   wire (default), sketch and custom draw the kit itself.
 *   fluent, mac, adwaita, egui and material are the platform looks, one
 *   stylesheet each in skins/.
 *
 * The toolbar swaps the skin sheet and remembers the choice. The fluent skin
 * also has a script, skins/fluent.js, because it upgrades the wf-* controls
 * into the real Fluent UI Web Components: that file is loaded once, the first
 * time fluent is picked, and it follows every later switch through mkchange.
 *
 * A page that pins one skin per artboard puts data-skin="pin" on the main
 * element, which no skin matches, and keeps its own sheets. The toolbar leaves
 * such a page alone: it names the state "per screen" and swaps nothing.
 *
 * Modes
 *
 *   canvas   every artboard in rows, pan and zoom, the place a reader starts
 *   focus    one artboard large, the notes and the comments at its side
 *   play     one screen at a time, hotspots live, no tool chrome over a screen
 *
 * The state lives in the DOM and in the URL: the hash is the artboard id, so a
 * link holds a screen. Escape goes back to the canvas. ?skin= and ?view= and
 * ?screen= set the first frame, which is what a screenshot wants.
 *
 * Keys
 *
 *   w a s d and the arrows pan the canvas, + - 0 and z zoom it, [ ] and Tab
 *   pick a screen, Enter opens it and Escape goes back to the canvas. 1 to 9
 *   pick a state of the screen the keys are on, and ? lists every one of them.
 *   A field keeps its own keys and a chord with meta, ctrl or alt is never ours.
 *
 * Comments are read and written at data-store, default ../_data/mockup-comments
 * relative to the page, and the store holds {value: [{id, artboard, text, at}]}.
 * The server records who wrote it: this file never sends an author.
 */
(function () {
  'use strict';

  var main = document.querySelector('.mockup');
  if (!main) {
    return;
  }

  var SKINS = ['wire', 'sketch', 'custom', 'fluent', 'mac', 'adwaita', 'egui', 'material'];
  var SKIN_KEY = 'rshow-mockup-skin';
  var PIN = 'pin';
  var pinned = (main.getAttribute('data-skin') || '').toLowerCase() === PIN;
  var DEFAULT_SIZE = {
    browser: [1280, 800],
    phone: [390, 844],
    tablet: [834, 1112],
    desktop: [1280, 800],
    custom: [1280, 800],
    terminal: [1000, 640],
    bare: [1280, 800]
  };

  var scriptSrc = (function () {
    var found = document.currentScript;
    if (!found) {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i -= 1) {
        if (/mockup\.js(\?|#|$)/.test(all[i].src)) {
          found = all[i];
          break;
        }
      }
    }
    return found ? found.src : '';
  }());

  // ------------------------------------------------------------- helpers --

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function list(value) {
    return String(value || '')
      .split(',')
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return part !== '';
      });
  }

  function boardIndex(id) {
    for (var i = 0; i < boards.length; i += 1) {
      if (boards[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  function boardById(id) {
    var index = boardIndex(id);
    return index < 0 ? null : boards[index];
  }

  function current() {
    return boardById(currentId);
  }

  function storage(key, value, write) {
    try {
      if (write) {
        window.localStorage.setItem(key, value);
        return value;
      }
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  // -------------------------------------------------------------- build ---

  var boards = [];
  var sections = main.querySelectorAll('section.artboard');
  var i;

  for (i = 0; i < sections.length; i += 1) {
    var section = sections[i];
    var frame = (section.getAttribute('data-frame') || 'bare').toLowerCase();
    var size = DEFAULT_SIZE[frame] || DEFAULT_SIZE.bare;
    var board = {
      el: section,
      id: section.id || 'screen-' + (i + 1),
      frame: frame,
      os: (section.getAttribute('data-os') || 'mac').toLowerCase(),
      title: section.getAttribute('data-title') || section.id || 'Screen ' + (i + 1),
      url: section.getAttribute('data-url') || '',
      status: section.getAttribute('data-status') || '',
      states: list(section.getAttribute('data-states')),
      state: '',
      pins: []
    };
    board.winTitle = section.getAttribute('data-window-title') || board.title;
    if (!section.id) {
      section.id = board.id;
    }
    boards.push(board);
  }

  // The screen holds the author's blocks; the head and the frame go around it.
  function wrapBoard(board) {
    var content = [];
    while (board.el.firstChild) {
      content.push(board.el.removeChild(board.el.firstChild));
    }

    var head = el('div', 'mk-head');
    var title = el('button', 'mk-title', board.title);
    title.type = 'button';
    title.setAttribute('title', 'Focus this screen');
    title.addEventListener('click', function () {
      focus(board.id);
    });
    head.appendChild(title);

    if (board.states.length > 0) {
      var bar = el('div', 'mk-statebar');
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'States of ' + board.title);
      var names = [''].concat(board.states);
      names.forEach(function (name) {
        var button = el('button', 'mk-state', name === '' ? 'Default' : name);
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', function () {
          setState(board, name);
        });
        bar.appendChild(button);
      });
      head.appendChild(bar);
    }

    var frame = el('div', 'mk-frame');
    var chrome = buildChrome(board);
    for (var c = 0; c < chrome.length; c += 1) {
      frame.appendChild(chrome[c]);
    }

    var w = board.el.getAttribute('data-w');
    var h = board.el.getAttribute('data-h');
    var screen = el('div', 'mk-screen');
    screen.style.setProperty('--mk-w', (w ? w : (DEFAULT_SIZE[board.frame] || DEFAULT_SIZE.bare)[0]) + 'px');
    screen.style.setProperty('--mk-h', (h ? h : (DEFAULT_SIZE[board.frame] || DEFAULT_SIZE.bare)[1]) + 'px');
    if (board.el.hasAttribute('data-drag')) {
      frame.style.setProperty('--mk-drag', board.el.getAttribute('data-drag') + 'px');
    }
    for (var k = 0; k < content.length; k += 1) {
      screen.appendChild(content[k]);
    }
    frame.appendChild(screen);
    board.screen = screen;

    // The drag region and the control area of a frameless window are tool
    // drawing, so they go over the screen and not under its paper.
    var overlay = frame.querySelector('.mk-overlay');
    if (overlay !== null) {
      frame.appendChild(overlay);
    }

    board.el.appendChild(head);
    board.el.appendChild(frame);

    // A terminal screen takes the ground of the tui grid inside it, so a grid
    // that does not fill the screen leaves no light strip around the cells.
    if (board.frame === 'terminal') {
      var grid = screen.querySelector('.tui');
      if (grid !== null) {
        var ground = window.getComputedStyle(grid).getPropertyValue('--tui-bg').trim();
        if (ground !== '') {
          screen.style.backgroundColor = ground;
        }
      }
    }

    // The numbered pins. The number is functional: it ties a mark on the
    // screen to a line in the notes panel.
    var pins = screen.querySelectorAll('.note-pin');
    for (var p = 0; p < pins.length; p += 1) {
      var text = pins[p].getAttribute('data-note') || '';
      pins[p].textContent = String(p + 1);
      pins[p].setAttribute('data-note-n', String(p + 1));
      pins[p].setAttribute('role', 'note');
      pins[p].setAttribute('aria-label', 'Note ' + (p + 1) + ': ' + text);
      pins[p].setAttribute('title', text);
      pins[p].setAttribute('tabindex', '0');
      board.pins.push({ n: p + 1, text: text });
    }

    // A hotspot that is not a link still answers the keyboard.
    var hotspots = screen.querySelectorAll('[data-goto]');
    for (var s = 0; s < hotspots.length; s += 1) {
      if (!hotspots[s].hasAttribute('tabindex')) {
        hotspots[s].setAttribute('tabindex', '0');
      }
      if (!hotspots[s].hasAttribute('role') && hotspots[s].tagName !== 'A' && hotspots[s].tagName !== 'BUTTON') {
        hotspots[s].setAttribute('role', 'link');
      }
    }
  }

  function buildChrome(board) {
    var nodes = [];
    var bar;
    var j;

    if (board.frame === 'browser') {
      bar = el('div', 'mk-bar');
      bar.setAttribute('aria-hidden', 'true');
      var tabs = el('div', 'mk-tabs');
      var active = el('div', 'mk-tab');
      active.setAttribute('aria-selected', 'true');
      active.appendChild(el('span', 'mk-tab-title', board.winTitle));
      tabs.appendChild(active);
      var second = el('div', 'mk-tab');
      second.appendChild(el('span', 'mk-tab-title', 'New tab'));
      tabs.appendChild(second);
      tabs.appendChild(el('span', 'mk-tab-add', '+'));
      bar.appendChild(tabs);
      var row = el('div', 'mk-addr-row');
      var addr = el('div', 'mk-addr');
      addr.appendChild(el('span', 'mk-addr-lock'));
      addr.appendChild(el('span', 'mk-addr-text', board.url || board.winTitle));
      addr.appendChild(el('span', 'mk-addr-menu'));
      row.appendChild(addr);
      bar.appendChild(row);
      nodes.push(bar);
      return nodes;
    }

    if (board.frame === 'phone' || board.frame === 'tablet') {
      if (board.frame === 'phone' || board.status !== '') {
        bar = el('div', 'mk-bar');
        bar.setAttribute('aria-hidden', 'true');
        if (board.frame === 'phone' || board.status !== '') {
          bar.appendChild(el('span', 'mk-status-time', board.status || '9:41'));
          var icons = el('span', 'mk-status-icons');
          icons.appendChild(el('i'));
          icons.appendChild(el('i'));
          icons.appendChild(el('i'));
          bar.appendChild(icons);
        }
        nodes.push(bar);
      }
      return nodes;
    }

    if (board.frame === 'desktop') {
      bar = el('div', 'mk-bar');
      bar.setAttribute('aria-hidden', 'true');

      if (board.os === 'windows') {
        bar.appendChild(el('span', 'mk-win-title', board.winTitle));
        var winControls = el('span', 'mk-win-controls');
        winControls.appendChild(el('span', 'mk-ctl mk-ctl--min'));
        winControls.appendChild(el('span', 'mk-ctl mk-ctl--max'));
        winControls.appendChild(el('span', 'mk-ctl mk-ctl--close'));
        bar.appendChild(winControls);
      } else if (board.os === 'linux') {
        bar.appendChild(el('span', 'mk-win-title', board.winTitle));
        var linuxControls = el('span', 'mk-win-controls');
        var round = el('span', 'mk-ctl mk-ctl--round mk-ctl--close');
        linuxControls.appendChild(round);
        bar.appendChild(linuxControls);
      } else {
        var dots = el('span', 'mk-dots');
        for (j = 0; j < 3; j += 1) {
          dots.appendChild(el('i'));
        }
        bar.appendChild(dots);
        bar.appendChild(el('span', 'mk-win-title', board.winTitle));
        bar.appendChild(el('span'));
      }
      nodes.push(bar);
      return nodes;
    }

    if (board.frame === 'custom') {
      var overlay = el('div', 'mk-overlay');
      overlay.setAttribute('aria-hidden', 'true');
      if (board.el.querySelector('.drag-region') === null) {
        overlay.appendChild(el('div', 'mk-drag-zone', 'drag region'));
      }
      if (board.el.hasAttribute('data-controls')) {
        overlay.appendChild(el('div', 'mk-controls-zone', 'window controls'));
      }
      if (overlay.childNodes.length > 0) {
        nodes.push(overlay);
      }
      return nodes;
    }

    // A terminal is one bar and one body: the title in mono on the left and,
    // when the artboard names one, the size or the shell on the right. No
    // traffic light dots and no vendor chrome, the same frame terminal.css
    // draws around a capture.
    if (board.frame === 'terminal') {
      bar = el('div', 'mk-bar');
      bar.setAttribute('aria-hidden', 'true');
      bar.style.fontFamily = 'var(--font-mono, ui-monospace, monospace)';
      bar.appendChild(el('span', 'mk-win-title', board.winTitle));
      if (board.status !== '') {
        var termStatus = el('span', 'mk-win-title', board.status);
        termStatus.style.marginLeft = 'auto';
        termStatus.style.opacity = '0.7';
        bar.appendChild(termStatus);
      }
      nodes.push(bar);
      return nodes;
    }

    return nodes;
  }

  // ------------------------------------------------------------ the shell --

  var toolbar = el('div', 'mk-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Mockup');

  var nameEl = el('span', 'mk-name', main.getAttribute('data-name') || document.title || 'Mockup');
  toolbar.appendChild(nameEl);

  var zoomGroup = el('span', 'mk-group');
  var zoomOut = el('button', 'mk-button', '-');
  zoomOut.type = 'button';
  zoomOut.setAttribute('data-mk', 'zoom-out');
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomOut.setAttribute('title', 'Zoom out (-)');
  zoomGroup.appendChild(zoomOut);

  var zoomLabel = el('span', 'mk-zoom', '100%');
  zoomGroup.appendChild(zoomLabel);

  var zoomIn = el('button', 'mk-button', '+');
  zoomIn.type = 'button';
  zoomIn.setAttribute('data-mk', 'zoom-in');
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomIn.setAttribute('title', 'Zoom in (+)');
  zoomGroup.appendChild(zoomIn);

  var fitButton = el('button', 'mk-button', 'Fit all');
  fitButton.type = 'button';
  fitButton.setAttribute('data-mk', 'zoom-fit');
  fitButton.setAttribute('title', 'Show every screen (0)');
  zoomGroup.appendChild(fitButton);
  toolbar.appendChild(zoomGroup);

  var skinGroup = el('span', 'mk-group');
  var skinField = el('label', 'mk-field');
  skinField.appendChild(el('span', 'mk-field-text', 'Skin'));
  var skinSelect = el('select');
  skinSelect.setAttribute('data-mk', 'skin');
  skinSelect.setAttribute('aria-label', 'Skin');
  if (pinned) {
    // The artboards on this page name their own skins, so there is one state
    // the toolbar has to be able to name and none it can apply.
    var pinOption = el('option', null, 'per screen');
    pinOption.value = PIN;
    skinSelect.appendChild(pinOption);
  }
  SKINS.forEach(function (skin) {
    var option = el('option', null, skin);
    option.value = skin;
    skinSelect.appendChild(option);
  });
  skinField.appendChild(skinSelect);
  skinGroup.appendChild(skinField);
  toolbar.appendChild(skinGroup);

  var playGroup = el('span', 'mk-group');
  var playButton = el('button', 'mk-button', 'Play');
  playButton.type = 'button';
  playButton.setAttribute('data-mk', 'play');
  playButton.setAttribute('aria-pressed', 'false');
  playButton.setAttribute('title', 'One screen at a time, hotspots live');
  playGroup.appendChild(playButton);
  toolbar.appendChild(playGroup);

  var modeHost = el('span', 'mk-group');
  var modeButton = el('button');
  modeButton.type = 'button';
  modeButton.setAttribute('data-rshow-mode-toggle', '');
  modeHost.appendChild(modeButton);
  toolbar.appendChild(modeHost);

  var hints = el('span', 'mk-hint', 'Drag to pan, Ctrl and wheel to zoom, ? for the keys');
  toolbar.appendChild(hints);

  // The bar that names the screen in focus and in play.
  var focusnav = el('div', 'mk-focusnav');
  var backButton = el('button', 'mk-button', 'Canvas');
  backButton.type = 'button';
  backButton.setAttribute('data-mk', 'back');
  backButton.setAttribute('title', 'Back to every screen (Esc)');
  focusnav.appendChild(backButton);

  var prevButton = el('button', 'mk-button', 'Previous');
  prevButton.type = 'button';
  prevButton.setAttribute('data-mk', 'prev');
  prevButton.setAttribute('aria-label', 'Previous screen');
  focusnav.appendChild(prevButton);

  var nextButton = el('button', 'mk-button', 'Next');
  nextButton.type = 'button';
  nextButton.setAttribute('data-mk', 'next');
  nextButton.setAttribute('aria-label', 'Next screen');
  focusnav.appendChild(nextButton);

  var trail = el('span', 'mk-trail');
  focusnav.appendChild(trail);
  var countEl = el('span', 'mk-count');
  focusnav.appendChild(countEl);

  var stage = el('div', 'mk-stage');
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', 'Mockup canvas');
  var world = el('div', 'mk-world');
  stage.appendChild(world);

  // The side panel: notes above, comments below.
  var side = el('aside', 'mk-side');
  side.setAttribute('aria-label', 'Screen details');

  var notePanel = el('section', 'mk-panel');
  notePanel.appendChild(el('h2', null, 'Notes'));
  var noteList = el('ul', 'mk-note-list');
  notePanel.appendChild(noteList);
  side.appendChild(notePanel);

  var commentPanel = el('section', 'mk-panel');
  commentPanel.appendChild(el('h2', null, 'Comments'));
  var commentList = el('div', 'mk-comments');
  commentPanel.appendChild(commentList);
  var commentForm = el('form', 'mk-form');
  var commentInput = el('textarea');
  commentInput.setAttribute('rows', '2');
  commentInput.setAttribute('aria-label', 'Comment on this screen');
  commentInput.setAttribute('placeholder', 'What needs to change?');
  commentForm.appendChild(commentInput);
  var commentSubmit = el('button', null, 'Add comment');
  commentSubmit.type = 'submit';
  commentForm.appendChild(commentSubmit);
  commentPanel.appendChild(commentForm);
  side.appendChild(commentPanel);

  main.appendChild(toolbar);
  main.appendChild(focusnav);
  main.appendChild(stage);
  main.appendChild(side);

  // ---------------------------------------------------------------- keys ---

  var KEYS = [
    ['w a s d', 'Pan the canvas'],
    ['arrow keys', 'Pan the canvas, or step between screens'],
    ['Shift and a key', 'Pan a quarter of the stage'],
    ['+ -', 'Zoom in and out'],
    ['0', 'Fit every screen'],
    ['z', 'Zoom to 100%'],
    ['[ ] or Tab', 'Previous and next screen'],
    ['Enter', 'Open the selected screen'],
    ['1 to 9', 'Pick a state of that screen'],
    ['Esc', 'Back to the canvas, or close this list'],
    ['?', 'Show or hide this list']
  ];

  var keysOpen = false;

  var keysPanel = el('div', 'mk-keys');
  keysPanel.setAttribute('role', 'dialog');
  keysPanel.setAttribute('aria-label', 'Keys');
  keysPanel.hidden = true;
  var keysList = el('dl', 'mk-keys-list');
  KEYS.forEach(function (row) {
    keysList.appendChild(el('dt', null, row[0]));
    keysList.appendChild(el('dd', null, row[1]));
  });
  keysPanel.appendChild(keysList);
  stage.appendChild(keysPanel);

  // The corner button says what it is, so a reader who never guesses ? still
  // finds the list. The pointerdown guard leaves the buttons of the stage alone.
  var keysButton = el('button', 'mk-keys-toggle', '? keys');
  keysButton.type = 'button';
  keysButton.setAttribute('aria-label', 'Keys');
  keysButton.setAttribute('aria-expanded', 'false');
  keysButton.setAttribute('title', 'Every key (?)');
  keysButton.addEventListener('click', function () {
    setKeys(!keysOpen);
  });
  stage.appendChild(keysButton);

  function setKeys(open) {
    keysOpen = open === true;
    keysPanel.hidden = !keysOpen;
    keysButton.setAttribute('aria-expanded', keysOpen ? 'true' : 'false');
  }

  // Rows: wide screens and phones pack side by side, everything stays in the
  // same visual order as the markup.
  function layoutRows() {
    while (world.firstChild) {
      world.removeChild(world.firstChild);
    }
    var row = el('div', 'mk-row');
    world.appendChild(row);
    var used = 0;
    for (var b = 0; b < boards.length; b += 1) {
      // Measure in place: a board inside a flex row is exactly as wide as its
      // frame, and that is the width a row has to budget for.
      row.appendChild(boards[b].el);
      var width = boards[b].el.offsetWidth;
      if (used > 0 && used + width > 2800) {
        row.removeChild(boards[b].el);
        row = el('div', 'mk-row');
        world.appendChild(row);
        row.appendChild(boards[b].el);
        used = 0;
      }
      used += width + 64;
    }
  }

  for (i = 0; i < boards.length; i += 1) {
    wrapBoard(boards[i]);
  }
  layoutRows();

  // ---------------------------------------------------------------- view --

  var view = 'canvas';
  var zoom = 1;
  var tx = 0;
  var ty = 0;
  var currentId = null;
  var canvasState = { zoom: 1, tx: 0, ty: 0 };
  var changeTimer = null;

  function fireChange() {
    if (changeTimer !== null) {
      window.clearTimeout(changeTimer);
    }
    changeTimer = window.setTimeout(function () {
      changeTimer = null;
      try {
        document.dispatchEvent(new window.CustomEvent('mkchange', { detail: { view: view, zoom: zoom } }));
      } catch (err) {
        // No CustomEvent: a skin that draws keeps its first drawing.
      }
    }, 60);
  }

  function applyTransform(save) {
    world.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px) scale(' + zoom + ')';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    if (save === true && view === 'canvas') {
      canvasState = { zoom: zoom, tx: tx, ty: ty };
    }
    fireChange();
  }

  function stageBox() {
    return stage.getBoundingClientRect();
  }

  function centerWorld() {
    var box = stageBox();
    var w = world.offsetWidth * zoom;
    var h = world.offsetHeight * zoom;
    tx = (box.width - w) / 2;
    ty = (box.height - h) / 2;
  }

  function fitAll() {
    stopAnimation();
    var box = stageBox();
    var w = world.offsetWidth;
    var h = world.offsetHeight;
    if (w === 0 || h === 0) {
      return;
    }
    zoom = Math.max(0.1, Math.min((box.width - 48) / w, (box.height - 48) / h, 1));
    centerWorld();
    applyTransform(true);
  }

  function clampPoint(x, y) {
    var box = stageBox();
    var w = world.offsetWidth * zoom;
    var h = world.offsetHeight * zoom;
    var pad = 80;
    var at = { x: x, y: y };
    if (w <= box.width) {
      at.x = (box.width - w) / 2;
    } else {
      at.x = Math.min(pad, Math.max(box.width - w - pad, at.x));
    }
    if (h <= box.height) {
      at.y = (box.height - h) / 2;
    } else {
      at.y = Math.min(pad, Math.max(box.height - h - pad, at.y));
    }
    return at;
  }

  function clamp() {
    var at = clampPoint(tx, ty);
    tx = at.x;
    ty = at.y;
  }

  function zoomTo(next, clientX, clientY) {
    stopAnimation();
    var box = stageBox();
    var sx = clientX === undefined ? box.width / 2 : clientX - box.left;
    var sy = clientY === undefined ? box.height / 2 : clientY - box.top;
    var limit = Math.min(2, Math.max(0.1, next));
    var wx = (sx - tx) / zoom;
    var wy = (sy - ty) / zoom;
    zoom = limit;
    tx = sx - wx * zoom;
    ty = sy - wy * zoom;
    clamp();
    applyTransform(true);
  }

  function zoomStep(direction) {
    var steps = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
    var at = zoom;
    var j;
    if (direction > 0) {
      for (j = 0; j < steps.length; j += 1) {
        if (steps[j] > at + 0.001) {
          zoomTo(steps[j]);
          return;
        }
      }
      zoomTo(2);
      return;
    }
    for (j = steps.length - 1; j >= 0; j -= 1) {
      if (steps[j] < at - 0.001) {
        zoomTo(steps[j]);
        return;
      }
    }
    zoomTo(0.1);
  }

  // ------------------------------------------------------------ selection --

  var selectedId = null;
  var panAnimation = null;

  function markSelected() {
    for (var b = 0; b < boards.length; b += 1) {
      boards[b].el.classList.toggle('is-selected', boards[b].id === selectedId);
    }
  }

  function selectedBoard() {
    return view === 'canvas' ? boardById(selectedId) : current();
  }

  function pickState(index) {
    var board = selectedBoard();
    if (!board) {
      return false;
    }
    var names = [''].concat(board.states);
    if (index < 0 || index >= names.length) {
      return false;
    }
    setState(board, names[index]);
    return true;
  }

  // Where a board sits in the stage, measured with the canvas transform out of
  // the way, so a selection lands on it at whatever the zoom is.
  function boardAt(board) {
    var box = stageBox();
    var saved = world.style.transform;
    world.style.transform = 'translate(0px,0px) scale(1)';
    var rect = board.el.getBoundingClientRect();
    world.style.transform = saved;
    return { x: rect.left - box.left, y: rect.top - box.top, w: rect.width, h: rect.height };
  }

  function stopAnimation() {
    if (panAnimation !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(panAnimation.frame);
      }
      window.clearTimeout(panAnimation.timer);
      panAnimation = null;
    }
  }

  function animateTo(x, y) {
    stopAnimation();
    var run = { frame: null, timer: null };
    panAnimation = run;

    function finish() {
      if (panAnimation !== run) {
        return;
      }
      panAnimation = null;
      tx = x;
      ty = y;
      applyTransform(true);
    }

    if (typeof window.requestAnimationFrame !== 'function') {
      finish();
      return;
    }
    var fromX = tx;
    var fromY = ty;
    var started = null;

    function frame(now) {
      if (panAnimation !== run) {
        return;
      }
      var at = typeof now === 'number' ? now : 0;
      if (started === null) {
        started = at;
      }
      var t = Math.min(1, (at - started) / 220);
      var eased = 1 - (1 - t) * (1 - t) * (1 - t);
      tx = fromX + (x - fromX) * eased;
      ty = fromY + (y - fromY) * eased;
      applyTransform(true);
      if (t < 1) {
        run.frame = window.requestAnimationFrame(frame);
        return;
      }
      finish();
    }

    run.frame = window.requestAnimationFrame(frame);
    // A window that draws no frames, such as the headless one behind a
    // screenshot, still lands on the screen the keys picked.
    run.timer = window.setTimeout(finish, 320);
  }

  function centreOn(board, animate) {
    var at = boardAt(board);
    var box = stageBox();
    var to = clampPoint(
      (box.width - at.w * zoom) / 2 - at.x * zoom,
      (box.height - at.h * zoom) / 2 - at.y * zoom
    );
    if (animate !== true) {
      tx = to.x;
      ty = to.y;
      applyTransform(true);
      return;
    }
    animateTo(to.x, to.y);
  }

  function selectBoard(index) {
    var count = boards.length;
    if (count === 0) {
      return;
    }
    var at = ((index % count) + count) % count;
    selectedId = boards[at].id;
    markSelected();
    if (view === 'canvas') {
      centreOn(boards[at], true);
    }
  }

  function stepSelection(delta) {
    if (boards.length === 0) {
      return;
    }
    var at = selectedId === null ? -1 : boardIndex(selectedId);
    if (at < 0) {
      at = delta < 0 ? boards.length : -1;
    }
    selectBoard(at + delta);
  }

  function markCurrent() {
    for (var b = 0; b < boards.length; b += 1) {
      boards[b].el.classList.toggle('is-current', boards[b].id === currentId);
    }
  }

  function layoutCurrent() {
    stopAnimation();
    var board = current();
    if (!board) {
      return;
    }
    var w = board.el.offsetWidth;
    var h = board.el.offsetHeight;
    if (w === 0 || h === 0) {
      return;
    }
    // Where the board sits in the stage, measured with the canvas transform
    // out of the way, then scaled and centred on that point.
    world.style.transform = 'translate(0px,0px) scale(1)';
    var box = stageBox();
    var rect = board.el.getBoundingClientRect();
    var pad = view === 'play' ? 20 : 40;
    zoom = Math.max(0.1, Math.min((box.width - pad * 2) / w, (box.height - pad * 2) / h, 1));
    tx = (box.width - w * zoom) / 2 - (rect.left - box.left) * zoom;
    ty = (box.height - h * zoom) / 2 - (rect.top - box.top) * zoom;
    applyTransform(false);
  }

  function setView(next) {
    view = next;
    main.setAttribute('data-view', next);
    markCurrent();
    var inCanvas = next === 'canvas';
    playButton.textContent = next === 'play' ? 'Exit' : 'Play';
    playButton.setAttribute('aria-pressed', next === 'play' ? 'true' : 'false');
    zoomOut.disabled = !inCanvas;
    zoomIn.disabled = !inCanvas;
    fitButton.disabled = !inCanvas;
    renderPanel();
    if (!inCanvas) {
      layoutCurrent();
    }
    fireChange();
  }

  function writeHash(id) {
    var next = id ? '#' + id : '';
    if (next === '') {
      if (window.location.hash !== '') {
        suppressHash = true;
        window.location.hash = '';
        window.setTimeout(function () {
          suppressHash = false;
        }, 0);
      }
      return;
    }
    if (window.location.hash !== next) {
      suppressHash = true;
      window.location.hash = next;
      window.setTimeout(function () {
        suppressHash = false;
      }, 0);
    }
  }

  function focus(id) {
    if (boardIndex(id) < 0) {
      return;
    }
    if (view === 'canvas') {
      canvasState = { zoom: zoom, tx: tx, ty: ty };
    }
    currentId = id;
    selectedId = id;
    markSelected();
    setView('focus');
    writeHash(id);
  }

  function play(id) {
    if (boardIndex(id) < 0) {
      return;
    }
    if (view === 'canvas') {
      canvasState = { zoom: zoom, tx: tx, ty: ty };
    }
    currentId = id;
    selectedId = id;
    markSelected();
    setView('play');
    writeHash(id);
  }

  function backToCanvas() {
    if (view !== 'canvas' && currentId !== null) {
      // The screen the reader was on stays the selected one, so the keys can
      // open it again or step from it.
      selectedId = currentId;
    }
    currentId = null;
    setView('canvas');
    markSelected();
    writeHash('');
    zoom = canvasState.zoom;
    tx = canvasState.tx;
    ty = canvasState.ty;
    applyTransform(false);
  }

  function step(delta) {
    if (currentId === null) {
      return;
    }
    var index = boardIndex(currentId);
    var next = index + delta;
    if (next < 0 || next >= boards.length) {
      return;
    }
    var id = boards[next].id;
    if (view === 'play') {
      play(id);
    } else {
      focus(id);
    }
  }

  // --------------------------------------------------------------- states --

  function setState(board, name) {
    board.state = name;
    if (name === '') {
      board.el.removeAttribute('data-state');
    } else {
      board.el.setAttribute('data-state', name);
    }
    var blocks = board.screen.querySelectorAll('[data-state]');
    for (var b = 0; b < blocks.length; b += 1) {
      var block = blocks[b];
      // A block inside another state block follows that one, so it does not
      // answer for itself. The artboard carries data-state too and is not one of
      // them, which is why the search stops at the screen.
      if (block.parentElement && block.parentElement !== board.screen) {
        var above = block.parentElement.closest('[data-state]');
        if (above !== null && board.screen.contains(above)) {
          continue;
        }
      }
      var own = list(block.getAttribute('data-state'));
      var wanted = name === '' ? 'default' : name;
      if (own.indexOf(wanted) !== -1) {
        block.style.display = '';
      } else {
        block.style.display = 'none';
      }
    }
    var buttons = board.el.querySelectorAll('.mk-state');
    for (var s = 0; s < buttons.length; s += 1) {
      var label = buttons[s].textContent;
      var mine = label === 'Default' ? '' : label;
      buttons[s].setAttribute('aria-pressed', mine === name ? 'true' : 'false');
    }
  }

  // --------------------------------------------------------------- panels --

  function renderPanel() {
    var board = current();
    while (noteList.firstChild) {
      noteList.removeChild(noteList.firstChild);
    }
    if (!board) {
      trail.textContent = '';
      countEl.textContent = '';
      return;
    }
    trail.textContent = board.title;
    countEl.textContent = boardIndex(board.id) + 1 + ' of ' + boards.length;
    if (board.pins.length === 0) {
      noteList.appendChild(el('li', 'mk-empty', 'No notes on this screen.'));
    } else {
      board.pins.forEach(function (pin) {
        var item = el('li', 'mk-note');
        item.appendChild(el('span', 'mk-note-n', String(pin.n)));
        item.appendChild(el('span', null, pin.text));
        noteList.appendChild(item);
      });
    }
    renderComments();
  }

  // ------------------------------------------------------------- comments --

  var store = main.getAttribute('data-store') || '../_data/mockup-comments';
  var comments = [];
  var commentState = 'loading';
  var commentBusy = false;

  function validComment(item) {
    return item && typeof item === 'object' && typeof item.text === 'string' && typeof item.artboard === 'string';
  }

  function when(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderComments() {
    var board = current();
    while (commentList.firstChild) {
      commentList.removeChild(commentList.firstChild);
    }
    var notice = null;
    if (commentState === 'unpublished') {
      notice = 'Comments are available once published.';
    } else if (commentState === 'signed-out') {
      notice = 'Sign in to comment.';
    } else if (commentState === 'loading') {
      notice = 'Loading comments...';
    } else if (commentState === 'error') {
      notice = 'The comment store did not accept that.';
    }

    if (board) {
      var mine = comments.filter(function (item) {
        return item.artboard === board.id;
      });
      mine.forEach(function (item) {
        var box = el('div', 'mk-comment');
        box.appendChild(el('p', null, item.text));
        var meta = when(item.at);
        if (meta !== '') {
          box.appendChild(el('p', 'mk-comment-meta', meta));
        }
        commentList.appendChild(box);
      });
      if (notice === null && mine.length === 0) {
        notice = 'No comments on this screen yet.';
      }
    }
    if (notice !== null) {
      commentList.appendChild(el('p', 'mk-empty', notice));
    }
    var ready = commentState === 'ready' && !commentBusy && board !== null;
    commentInput.disabled = !ready;
    commentSubmit.disabled = !ready;
  }

  function loadComments() {
    if (typeof window.fetch !== 'function') {
      commentState = 'unpublished';
      renderComments();
      return;
    }
    commentState = 'loading';
    renderComments();
    window
      .fetch(store, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (reply) {
        if (reply.status === 404) {
          commentState = 'unpublished';
          return;
        }
        if (reply.status === 401 || reply.status === 403) {
          commentState = 'signed-out';
          return;
        }
        if (!reply.ok) {
          commentState = 'unpublished';
          return;
        }
        return reply.json().then(function (body) {
          var value = body && body.value;
          comments = Array.isArray(value) ? value.filter(validComment) : [];
          commentState = 'ready';
        });
      })
      .catch(function () {
        commentState = 'unpublished';
      })
      .then(function () {
        renderComments();
      });
  }

  function saveComment(text) {
    var board = current();
    if (!board || text === '' || commentBusy) {
      return;
    }
    var now = new Date().toISOString();
    var next = comments.concat([
      {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        artboard: board.id,
        text: text,
        at: now
      }
    ]);
    commentBusy = true;
    renderComments();
    window
      .fetch(store, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ value: next })
      })
      .then(function (reply) {
        if (reply.status === 401 || reply.status === 403) {
          commentState = 'signed-out';
          return;
        }
        if (reply.status === 404) {
          commentState = 'unpublished';
          return;
        }
        if (!reply.ok) {
          commentState = 'error';
          return;
        }
        comments = next;
        commentInput.value = '';
        commentState = 'ready';
      })
      .catch(function () {
        commentState = 'unpublished';
      })
      .then(function () {
        commentBusy = false;
        renderComments();
      });
  }

  commentForm.addEventListener('submit', function (event) {
    event.preventDefault();
    saveComment(commentInput.value.trim());
  });

  // ---------------------------------------------------------------- skins --

  function skinLink() {
    return document.querySelector('link[data-mk-skin]') || document.getElementById('mk-skin');
  }

  function skinHref(name) {
    var link = skinLink();
    if (link && link.href) {
      return new window.URL(name + '.css', link.href).href;
    }
    if (scriptSrc) {
      return new window.URL('skins/' + name + '.css', scriptSrc).href;
    }
    return 'skins/' + name + '.css';
  }

  // A skin may carry a script that upgrades its own blocks. It is fetched once,
  // from the skin folder this file sits in, and it answers every later switch
  // through mkchange, so it never has to be fetched twice.
  var SKIN_SCRIPTS = { fluent: 'fluent.js' };

  function skinScriptLoaded(name) {
    var pattern = new window.RegExp('skins/' + name + '\\.js(?:\\?|#|$)');
    var all = document.getElementsByTagName('script');
    for (var i = 0; i < all.length; i += 1) {
      if (all[i].getAttribute('data-mk-skin-script') === name) {
        return true;
      }
      if (all[i].src && pattern.test(all[i].src)) {
        return true;
      }
    }
    return false;
  }

  function loadSkinScript(name) {
    var file = SKIN_SCRIPTS[name];
    if (!file || skinScriptLoaded(name)) {
      return;
    }
    var script = document.createElement('script');
    script.src = scriptSrc ? new window.URL('skins/' + file, scriptSrc).href : 'skins/' + file;
    script.defer = true;
    script.setAttribute('data-mk-skin-script', name);
    // A skin script that cannot load costs the upgrade and not the page: the
    // skin sheet alone still draws every control.
    script.addEventListener('error', function () {});
    document.head.appendChild(script);
  }

  function setSkin(name, remember) {
    if (name === PIN) {
      skinSelect.value = PIN;
      return;
    }
    if (SKINS.indexOf(name) < 0) {
      return;
    }
    skinSelect.value = name;
    loadSkinScript(name);
    if (pinned) {
      // Every artboard here names its own skin, so the page keeps its sheet and
      // its own data-skin. Only a skin script is loaded, which is what upgrades
      // the fluent screens this page already carries.
      fireChange();
      return;
    }
    main.setAttribute('data-skin', name);
    var link = skinLink();
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'mk-skin';
      link.setAttribute('data-mk-skin', '');
      document.head.appendChild(link);
    }
    var href = skinHref(name);
    if (link.getAttribute('href') !== href) {
      link.href = href;
    }
    if (remember === true) {
      storage(SKIN_KEY, name, true);
    }
    fireChange();
  }

  skinSelect.addEventListener('change', function () {
    setSkin(skinSelect.value, true);
  });

  // ---------------------------------------------------------------- input --

  var dragging = null;
  var spaceDown = false;
  var flashTimer = null;
  var suppressHash = false;

  // A control placed over the canvas owns its own pointer and its own keys.
  var CONTROLS =
    'button, a[href], input, select, textarea, label, summary, [role="button"], [tabindex]:not([tabindex="-1"])';

  function control(node) {
    if (!node || !node.closest) {
      return null;
    }
    return node.closest(CONTROLS);
  }

  toolbar.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-mk]') : null;
    if (!button) {
      return;
    }
    var action = button.getAttribute('data-mk');
    if (action === 'zoom-in') {
      zoomStep(1);
    } else if (action === 'zoom-out') {
      zoomStep(-1);
    } else if (action === 'zoom-fit') {
      fitAll();
    } else if (action === 'play') {
      if (view === 'play') {
        backToCanvas();
      } else {
        play(currentId || boards[0].id);
      }
    }
  });

  focusnav.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-mk]') : null;
    if (!button) {
      return;
    }
    var action = button.getAttribute('data-mk');
    if (action === 'back') {
      backToCanvas();
    } else if (action === 'prev') {
      step(-1);
    } else if (action === 'next') {
      step(1);
    }
  });

  function flash(screen) {
    screen.classList.add('mk-flash');
    if (flashTimer !== null) {
      window.clearTimeout(flashTimer);
    }
    flashTimer = window.setTimeout(function () {
      flashTimer = null;
      screen.classList.remove('mk-flash');
    }, 900);
  }

  main.addEventListener('click', function (event) {
    var target = event.target;
    if (!target.closest) {
      return;
    }
    var hotspot = target.closest('[data-goto], a[href^="#"]');
    if (hotspot) {
      var screen = hotspot.closest('.mk-screen');
      if (screen) {
        var id = hotspot.getAttribute('data-goto');
        if (!id) {
          id = (hotspot.getAttribute('href') || '').replace(/^#/, '');
        }
        if (id !== '' && boardIndex(id) >= 0) {
          event.preventDefault();
          if (view === 'play') {
            play(id);
          } else {
            focus(id);
          }
          return;
        }
      }
    }
    var here = target.closest('.mk-screen');
    if (here && view === 'play') {
      flash(here);
    }
  });

  main.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') {
      return;
    }
    var target = event.target;
    if (!target.closest) {
      return;
    }
    var hotspot = target.closest('[data-goto]');
    if (hotspot && target.closest('.mk-screen') && hotspot.tagName !== 'BUTTON') {
      event.preventDefault();
      hotspot.click();
    }
  });

  function startPan(event) {
    stopAnimation();
    dragging = { x: event.clientX, y: event.clientY, tx: tx, ty: ty };
    stage.classList.add('is-panning');
    if (stage.setPointerCapture) {
      try {
        stage.setPointerCapture(event.pointerId);
      } catch (err) {
        // A pointer that is already gone keeps the drag on the document.
      }
    }
  }

  stage.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) {
      return;
    }
    // A control above the screen keeps its own click: capturing the pointer
    // here would retarget that click to the stage.
    var taken = control(event.target);
    if (!spaceDown && taken !== null && taken !== stage) {
      return;
    }
    var inScreen = event.target.closest ? event.target.closest('.mk-screen') : null;
    if (!spaceDown && inScreen) {
      return;
    }
    if (view !== 'canvas' && !spaceDown) {
      return;
    }
    event.preventDefault();
    startPan(event);
  });

  stage.addEventListener('pointermove', function (event) {
    if (!dragging) {
      return;
    }
    tx = dragging.tx + (event.clientX - dragging.x);
    ty = dragging.ty + (event.clientY - dragging.y);
    if (view === 'canvas') {
      clamp();
    }
    applyTransform(false);
  });

  function endPan() {
    if (!dragging) {
      return;
    }
    dragging = null;
    stage.classList.remove('is-panning');
  }

  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);

  stage.addEventListener(
    'wheel',
    function (event) {
      if (view !== 'canvas') {
        return;
      }
      event.preventDefault();
      stopAnimation();
      if (event.ctrlKey || event.metaKey) {
        zoomTo(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY);
        return;
      }
      tx -= event.deltaX;
      ty -= event.deltaY;
      clamp();
      applyTransform(true);
    },
    { passive: false }
  );

  function typing(node) {
    if (!node) {
      return false;
    }
    var tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  }

  // Tab and Enter belong to the page while a reader is in the toolbar, the
  // panel or a screen: only the stage itself takes them over.
  function fromStage(node) {
    return node === document.body || node === document.documentElement || node === stage;
  }

  function panSize(event) {
    if (event.shiftKey === true) {
      var box = stageBox();
      return { x: Math.round(box.width / 4), y: Math.round(box.height / 4) };
    }
    return { x: 64, y: 64 };
  }

  // A screen taller than the stage scrolls under it. One that fits has nowhere
  // to go, so up and down leave it alone.
  function panTall(direction, event) {
    var board = current();
    var box = stageBox();
    if (!board || board.el.offsetHeight * zoom <= box.height) {
      return;
    }
    ty -= direction * panSize(event).y;
    applyTransform(false);
  }

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) {
      return;
    }
    var key = event.key;
    if (key === ' ' || key === 'Spacebar') {
      spaceDown = true;
      if (event.target === document.body) {
        event.preventDefault();
      }
      return;
    }
    if (key === '?') {
      event.preventDefault();
      setKeys(!keysOpen);
      return;
    }
    if (key === 'Escape') {
      if (keysOpen) {
        event.preventDefault();
        setKeys(false);
        return;
      }
      if (view !== 'canvas') {
        event.preventDefault();
        backToCanvas();
      }
      return;
    }
    if (key >= '1' && key <= '9' && key.length === 1) {
      if (pickState(Number(key) - 1)) {
        event.preventDefault();
      }
      return;
    }
    if (key === '+' || key === '=') {
      event.preventDefault();
      zoomStep(1);
      return;
    }
    if (key === '-' || key === '_') {
      event.preventDefault();
      zoomStep(-1);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      if (view === 'canvas') {
        fitAll();
      }
      return;
    }
    if (key === 'z' || key === 'Z') {
      if (view === 'canvas') {
        event.preventDefault();
        zoomTo(1);
      }
      return;
    }
    if (key === ']' || key === '[') {
      event.preventDefault();
      var order = key === ']' ? 1 : -1;
      if (view === 'canvas') {
        stepSelection(order);
      } else {
        step(order);
      }
      return;
    }
    if (key === 'Tab') {
      if (view === 'canvas' && fromStage(event.target) && control(event.target) === null) {
        event.preventDefault();
        stepSelection(event.shiftKey === true ? -1 : 1);
      }
      return;
    }
    if (key === 'Enter') {
      if (view !== 'canvas' || selectedId === null || control(event.target) !== null) {
        return;
      }
      event.preventDefault();
      focus(selectedId);
      return;
    }
    var dx = 0;
    var dy = 0;
    if (key === 'ArrowRight' || key === 'd' || key === 'D') {
      dx = 1;
    } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
      dx = -1;
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
      dy = 1;
    } else if (key === 'ArrowUp' || key === 'w' || key === 'W') {
      dy = -1;
    }
    if (dx === 0 && dy === 0) {
      return;
    }
    event.preventDefault();
    if (view === 'canvas') {
      var stepSize = panSize(event);
      stopAnimation();
      tx -= dx * stepSize.x;
      ty -= dy * stepSize.y;
      clamp();
      applyTransform(true);
      return;
    }
    if (dx !== 0) {
      step(dx);
      return;
    }
    panTall(dy, event);
  });

  document.addEventListener('keyup', function (event) {
    if (event.key === ' ' || event.key === 'Spacebar') {
      spaceDown = false;
    }
  });

  window.addEventListener('blur', function () {
    spaceDown = false;
    endPan();
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(function () {
      resizeTimer = null;
      if (view === 'canvas') {
        clamp();
        applyTransform(false);
      } else {
        layoutCurrent();
      }
      fireChange();
    }, 120);
  });

  // The stage changes size when the panel fills in, when a font arrives and when
  // the window moves, so the focused screen is sized from the stage it is in and
  // not from the one it was measured in.
  if (typeof window.ResizeObserver === 'function') {
    var stageWatcher = new window.ResizeObserver(function () {
      if (view !== 'canvas') {
        layoutCurrent();
      }
    });
    stageWatcher.observe(stage);
  }

  window.addEventListener('hashchange', function () {
    if (suppressHash) {
      return;
    }
    var id = window.location.hash.replace(/^#/, '');
    if (id === '') {
      if (view !== 'canvas') {
        backToCanvas();
      }
      return;
    }
    if (boardIndex(id) >= 0) {
      if (view === 'play') {
        play(id);
      } else {
        focus(id);
      }
    }
  });

  // ----------------------------------------------------------------- boot --

  var query = new URLSearchParams(window.location.search);
  // A pinned page keeps the skin each artboard names, so it starts on "per
  // screen"; ?skin= can still name a skin there, which loads that skin's script
  // and changes nothing else.
  var asked = (query.get('skin') || '').toLowerCase();
  var firstSkin = asked !== '' ? asked : pinned ? PIN : storage(SKIN_KEY, null, false) || main.getAttribute('data-skin') || 'wire';
  firstSkin = String(firstSkin).toLowerCase();
  if (firstSkin !== PIN && SKINS.indexOf(firstSkin) < 0) {
    firstSkin = pinned ? PIN : 'wire';
  }
  setSkin(firstSkin, false);

  for (i = 0; i < boards.length; i += 1) {
    setState(boards[i], '');
  }

  var requested = query.get('screen') || window.location.hash.replace(/^#/, '');
  var startView = query.get('view');
  main.setAttribute('data-view', 'canvas');
  fitAll();
  if (boards.length > 0) {
    if (requested !== '' && boardIndex(requested) >= 0) {
      if (startView === 'play') {
        play(requested);
      } else {
        focus(requested);
      }
    } else if (startView === 'play') {
      play(boards[0].id);
    } else if (startView === 'focus') {
      focus(boards[0].id);
    }
  }

  loadComments();
  fireChange();
}());
