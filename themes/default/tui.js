/*
 * rshow theme "default": the tui kit, the cell grid.
 *
 * tui.css draws a terminal; this file makes the grid real. It turns data-cols,
 * data-rows and data-lines into the custom properties the stylesheet measures
 * with, draws the box-drawing frame around every pane and dialog (a pane's title
 * lives inside its top border, and a border that is a line cannot hold a title),
 * fills gauges and sparklines with block characters, and then checks the
 * drawing against the rules the kit is built on:
 *
 *   - the minimum size gate: below 80x24 the grid is replaced by a resize
 *     message, because that is what a terminal that small shows;
 *   - exactly one focused surface: a pane, or the dialog over the panes;
 *   - no app binding on Ctrl+C, Ctrl+Z or Ctrl+\;
 *   - every block a whole number of cells, and anything that overflows is
 *     marked with an outline and named in the console.
 *
 * It is a drawing tool, not a terminal: no input handling, no scrollback, no
 * ANSI parser. What it checks, it reports in the console prefixed with
 * [rshow tui], and what it cannot fix it marks on the drawing.
 *
 * Re-runs on resize, after the fonts load, and on mkchange (a state switch in a
 * mockup shows different cells, and the cells have to be measured again).
 */
(function () {
  'use strict';

  var MIN_COLS = 80;
  var MIN_ROWS = 24;
  var TOLERANCE = 1.5;
  var SPARK = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
  var BLOCK = '\u2588';
  var BLOCK_EMPTY = '\u2591';
  var GLYPHS = {
    light: { tl: '\u250c', tr: '\u2510', bl: '\u2514', br: '\u2518', h: '\u2500', v: '\u2502' },
    double: { tl: '\u2554', tr: '\u2557', bl: '\u255a', br: '\u255d', h: '\u2550', v: '\u2551' },
    ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' }
  };

  var warned = {};

  function warn(message) {
    if (warned[message]) {
      return;
    }
    warned[message] = true;
    if (window.console && window.console.warn) {
      window.console.warn('[rshow tui] ' + message);
    }
  }

  function repeat(text, count) {
    var out = '';
    for (var i = 0; i < count; i += 1) {
      out += text;
    }
    return out;
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function visible(el) {
    return el.getClientRects().length > 0;
  }

  function px(value) {
    var n = parseFloat(value);
    return isNaN(n) ? 0 : n;
  }

  // ------------------------------------------------------------- the grid --

  function declare(root) {
    var cols = parseInt(root.getAttribute('data-cols'), 10);
    var rows = parseInt(root.getAttribute('data-rows'), 10);
    root.style.setProperty('--tui-cols', String(isNaN(cols) ? 80 : cols));
    root.style.setProperty('--tui-rows', String(isNaN(rows) ? 24 : rows));
    var size = root.getAttribute('data-size');
    if (size) {
      root.style.setProperty('--tui-size', size);
    }
    var cells = root.querySelectorAll('[data-cols], [data-lines]');
    for (var i = 0; i < cells.length; i += 1) {
      var el = cells[i];
      if (el === root) {
        continue;
      }
      if (el.hasAttribute('data-cols')) {
        el.style.setProperty('--tui-cols', el.getAttribute('data-cols'));
      }
      if (el.hasAttribute('data-lines')) {
        el.style.setProperty('--tui-lines', el.getAttribute('data-lines'));
      }
    }
    return {
      cols: isNaN(cols) ? 80 : cols,
      rows: isNaN(rows) ? 24 : rows
    };
  }

  function message(root, grid) {
    var block = root.querySelector('.tui-toosmall');
    if (!block) {
      block = document.createElement('div');
      block.className = 'tui-toosmall';
      root.insertBefore(block, root.firstChild);
    }
    var text = [
      '',
      '  Terminal too small',
      '',
      '  ' + grid.cols + ' columns x ' + grid.rows + ' rows',
      '  this tool needs at least ' + MIN_COLS + ' x ' + MIN_ROWS,
      '',
      '  Resize the window to continue.',
      ''
    ].join('\n');
    if (block.textContent !== text) {
      block.textContent = text;
    }
  }

  function gate(root, grid) {
    var small = grid.cols < MIN_COLS || grid.rows < MIN_ROWS;
    if (small) {
      message(root, grid);
      root.setAttribute('data-toosmall', 'true');
    } else {
      root.removeAttribute('data-toosmall');
    }
    return !small;
  }

  // ------------------------------------------------------------- measures --

  function cellWidth(root) {
    var probe = root.querySelector('.tui-probe');
    if (!probe) {
      probe = document.createElement('span');
      probe.className = 'tui-probe';
      probe.setAttribute('aria-hidden', 'true');
      probe.textContent = repeat('0', 20);
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.whiteSpace = 'pre';
      probe.style.top = '0';
      probe.style.left = '0';
      probe.style.pointerEvents = 'none';
      root.appendChild(probe);
    }
    var width = probe.getBoundingClientRect().width / 20;
    return width > 0 ? width : 8;
  }

  // --------------------------------------------------------------- frames --

  function frameLayers(el) {
    var frame = el.querySelector(':scope > .tui-frame');
    if (!frame) {
      frame = document.createElement('div');
      frame.className = 'tui-frame';
      frame.setAttribute('aria-hidden', 'true');
      el.insertBefore(frame, el.firstChild);
    }
    var parts = ['top', 'bottom', 'left', 'right'];
    var layers = {};
    for (var i = 0; i < parts.length; i += 1) {
      var layer = frame.querySelector('.tui-frame-' + parts[i]);
      if (!layer) {
        layer = document.createElement('span');
        layer.className = 'tui-frame-' + parts[i];
        frame.appendChild(layer);
      }
      layers[parts[i]] = layer;
    }
    return layers;
  }

  function drawFrame(el, ch, cellH, opts) {
    // The class first: it drops the fallback border, so the box is exactly the
    // cells it claims and the measurement below is a whole number of them.
    el.classList.add('tui-framed');
    var box = el.getBoundingClientRect();
    var cols = Math.max(4, Math.round(box.width / ch));
    var rows = Math.max(3, Math.round(box.height / cellH));
    var set = opts.ascii ? GLYPHS.ascii : opts.focus ? GLYPHS.double : GLYPHS.light;
    var layers = frameLayers(el);
    var title = opts.title || '';
    var inner = cols - 2;
    var head = '';
    if (title !== '') {
      head = set.h + '\u0020' + '<span class="tui-frame-title">' + escapeHtml(title) + '</span>' + '\u0020';
    }
    var headLength = title !== '' ? 3 + title.length : 0;
    var fill = inner - headLength;
    if (fill < 0) {
      head = '';
      fill = inner;
    }
    layers.top.innerHTML = escapeHtml(set.tl) + head + repeat(set.h, fill) + escapeHtml(set.tr);
    layers.bottom.textContent = set.bl + repeat(set.h, inner) + set.br;
    var side = repeat(set.v + '\n', Math.max(0, rows - 3)) + set.v;
    layers.left.textContent = side;
    layers.right.textContent = side;
    layers.left.style.height = String((rows - 2) * cellH) + 'px';
    layers.right.style.height = String((rows - 2) * cellH) + 'px';
    if (opts.focus) {
      el.classList.add('tui-frame-focus');
    } else {
      el.classList.remove('tui-frame-focus');
    }
    return { cols: cols, rows: rows };
  }

  function frames(root, ch) {
    var focusedDialog = null;
    var dialogs = root.querySelectorAll('.tui-dialog[data-focus]');
    for (var d = 0; d < dialogs.length; d += 1) {
      if (visible(dialogs[d])) {
        focusedDialog = dialogs[d];
      }
    }
    var all = root.querySelectorAll('.tui-pane, .tui-dialog');
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (!visible(el)) {
        continue;
      }
      var cellH = px(window.getComputedStyle(el).lineHeight);
      if (cellH <= 0) {
        cellH = px(window.getComputedStyle(el).fontSize) * 1.4;
      }
      var isDialog = el.classList.contains('tui-dialog');
      var ascii = el.hasAttribute('data-ascii') || root.getAttribute('data-charset') === 'ascii';
      drawFrame(el, ch, cellH, {
        title: el.getAttribute('data-title') || '',
        focus: isDialog ? el.hasAttribute('data-focus') : el.hasAttribute('data-focus') && focusedDialog === null,
        ascii: ascii
      });
    }
  }

  // ------------------------------------------------------- plot and gauge --

  function gauges(root) {
    var nodes = root.querySelectorAll('.tui-gauge[data-value]');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var width = parseInt(el.getAttribute('data-width'), 10);
      if (isNaN(width) || width <= 0) {
        width = 20;
      }
      var value = Math.max(0, Math.min(100, parseFloat(el.getAttribute('data-value')) || 0));
      var filled = Math.round((value / 100) * width);
      var label = el.getAttribute('data-show-value') !== null ? ' ' + Math.round(value) + '%' : '';
      var text = repeat(BLOCK, filled) + repeat(BLOCK_EMPTY, width - filled) + label;
      var empty = repeat(BLOCK_EMPTY, width - filled);
      var html = escapeHtml(repeat(BLOCK, filled));
      if (empty !== '') {
        html += '<span class="tui-gauge-empty">' + escapeHtml(empty) + '</span>';
      }
      if (label !== '') {
        html += escapeHtml(label);
      }
      if (el.innerHTML !== html) {
        el.innerHTML = html;
      }
      el.setAttribute('aria-label', Math.round(value) + '%');
      if (text === '') {
        warn('a gauge with no width: ' + el.className);
      }
    }
  }

  function sparklines(root) {
    var nodes = root.querySelectorAll('.tui-sparkline[data-values]');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var values = String(el.getAttribute('data-values')).split(/[\s,]+/);
      var numbers = [];
      for (var v = 0; v < values.length; v += 1) {
        var n = parseFloat(values[v]);
        if (!isNaN(n)) {
          numbers.push(n);
        }
      }
      if (numbers.length === 0) {
        continue;
      }
      var min = Math.min.apply(null, numbers);
      var max = Math.max.apply(null, numbers);
      var out = '';
      for (var k = 0; k < numbers.length; k += 1) {
        var t = max === min ? 0.5 : (numbers[k] - min) / (max - min);
        out += SPARK.charAt(Math.max(0, Math.min(SPARK.length - 1, Math.round(t * (SPARK.length - 1)))));
      }
      if (el.textContent !== out) {
        el.textContent = out;
      }
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', numbers.join(', '));
    }
  }

  // ---------------------------------------------------------------- rules --

  function focusRule(root) {
    var dialog = null;
    var dialogs = root.querySelectorAll('.tui-dialog[data-focus]');
    for (var d = 0; d < dialogs.length; d += 1) {
      if (visible(dialogs[d])) {
        dialog = dialogs[d];
      }
    }
    var panes = root.querySelectorAll('.tui-pane[data-focus]');
    var focused = 0;
    for (var i = 0; i < panes.length; i += 1) {
      if (visible(panes[i])) {
        focused += 1;
      }
    }
    var name = root.getAttribute('data-name') || root.id || 'terminal';
    if (dialog !== null) {
      // A dialog over the panes holds the keyboard: it is the one focused
      // surface, and the panes behind it keep their mark but are not focused.
      return;
    }
    if (focused === 0) {
      warn('no focused pane in "' + name + '": mark exactly one pane with data-focus');
    } else if (focused > 1) {
      warn('more than one focused pane in "' + name + '" (' + focused + '): a terminal has one keyboard focus');
    }
  }

  function keysRule(root) {
    var pattern = /(ctrl\s*[-+]\s*[cz\\]|\^\s*[cz\\]|\bc-[cz\\])/i;
    var zones = root.querySelectorAll('.tui-keys, .tui-statusbar, .tui-dialog');
    for (var i = 0; i < zones.length; i += 1) {
      var match = String(zones[i].textContent).match(pattern);
      if (match) {
        warn('"' + match[0] + '" is the terminal\'s key, not an app binding: Ctrl+C, Ctrl+Z and Ctrl+\\ belong to the terminal');
      }
    }
  }

  function overflowRule(root, ch) {
    var nodes = root.querySelectorAll(
      '.tui-list-item, .tui-line, .tui-keys, .tui-statusbar, .tui-table-row, .tui-input, .tui-dialog-body, .tui-body-lines'
    );
    var overflowed = 0;
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (!visible(el)) {
        el.classList.remove('tui-overflow');
        continue;
      }
      var clipped = el.scrollWidth > el.clientWidth + 1;
      var lines = el.classList.contains('tui-line') || el.classList.contains('tui-keys') || el.classList.contains('tui-list-item');
      if (clipped) {
        overflowed += 1;
        el.classList.add('tui-overflow');
      } else {
        el.classList.remove('tui-overflow');
      }
      if (lines && el.clientHeight > 0) {
        var cellH = px(window.getComputedStyle(el).lineHeight);
        if (cellH > 0 && Math.abs(el.clientHeight / cellH - Math.round(el.clientHeight / cellH)) * cellH > TOLERANCE) {
          warn('a block is not a whole number of lines: ' + describe(el));
        }
      }
    }
    var panes = root.querySelectorAll('.tui-pane, .tui-dialog');
    for (var p = 0; p < panes.length; p += 1) {
      var pane = panes[p];
      if (!visible(pane)) {
        continue;
      }
      var cellH2 = px(window.getComputedStyle(pane).lineHeight);
      if (cellH2 > 0) {
        var r = pane.clientHeight / cellH2;
        if (Math.abs(r - Math.round(r)) * cellH2 > TOLERANCE) {
          warn('a pane is not a whole number of lines: ' + describe(pane));
        }
      }
      if (ch > 0) {
        var c = pane.clientWidth / ch;
        if (Math.abs(c - Math.round(c)) * ch > TOLERANCE) {
          warn('a pane is not a whole number of cells wide: ' + describe(pane));
        }
      }
      var screen = root.querySelector('.tui-screen');
      if (screen && visible(screen)) {
        var sr = screen.getBoundingClientRect();
        var pr = pane.getBoundingClientRect();
        if (pr.right > sr.right + TOLERANCE || pr.bottom > sr.bottom + TOLERANCE) {
          warn('a pane runs past the grid: ' + describe(pane));
          pane.classList.add('tui-overflow');
        }
      }
    }
    if (overflowed > 0) {
      warn(overflowed + ' block(s) hold more cells than the grid gives them: the drawing clips, so the copy is too long');
    }
  }

  function describe(el) {
    var name = el.getAttribute('data-title') || el.getAttribute('data-name');
    var cls = String(el.className || '').split(/\s+/).slice(0, 2).join('.');
    return (name ? '"' + name + '" ' : '') + (cls ? '.' + cls : el.tagName.toLowerCase());
  }

  // ------------------------------------------------------------------ run --

  function run(root) {
    var grid = declare(root);
    if (!gate(root, grid)) {
      return;
    }
    var ch = cellWidth(root);
    frames(root, ch);
    gauges(root);
    sparklines(root);
    focusRule(root);
    keysRule(root);
    overflowRule(root, ch);
  }

  function refreshAll() {
    var terminals = document.querySelectorAll('.tui');
    for (var i = 0; i < terminals.length; i += 1) {
      run(terminals[i]);
    }
  }

  function watch(root) {
    if (typeof window.ResizeObserver === 'function') {
      var observer = new window.ResizeObserver(function () {
        window.clearTimeout(root.__tuiTimer);
        root.__tuiTimer = window.setTimeout(function () {
          run(root);
        }, 60);
      });
      observer.observe(root);
    }
  }

  function boot() {
    var terminals = document.querySelectorAll('.tui');
    for (var i = 0; i < terminals.length; i += 1) {
      run(terminals[i]);
      watch(terminals[i]);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        refreshAll();
      });
    }
    document.addEventListener('mkchange', function () {
      refreshAll();
    });
  }

  window.rshowTui = { refresh: refreshAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
