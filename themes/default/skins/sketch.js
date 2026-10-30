/*
 * rshow theme "default": the sketch pencil.
 *
 * sketch.css holds the geometry and the type of the sketch skin; this file
 * holds the pencil. Every wf-* element on a screen gets a rough outline drawn
 * behind it in one SVG per screen, sized in the screen's own coordinates, so
 * the drawing scales with a zoom and never needs a redraw for it.
 *
 * rough.js is fetched once, from jsdelivr, at one pinned version, and only when
 * a mockup is actually in the sketch skin. The seed of a shape comes from its
 * index and its class, so the same box is drawn the same way on every render
 * and a reader does not see the sketch jitter when a screen is focused.
 *
 * If the fetch fails, the skin becomes wire: a half drawn screen is worse than
 * a plain one.
 */
(function () {
  'use strict';

  var main = document.querySelector('.mockup');
  if (!main) {
    return;
  }

  var ROUGH_URL = 'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SELECTOR = [
    '.wf-box',
    '.wf-card',
    '.wf-image',
    '.wf-avatar',
    '.wf-icon',
    '.wf-text',
    '.wf-heading',
    '.wf-button',
    '.wf-input',
    '.wf-select',
    '.wf-checkbox',
    '.wf-toggle',
    '.wf-chart',
    '.wf-table',
    '.wf-modal',
    '.wf-toast',
    '.wf-nav',
    '.wf-sidebar',
    '.wf-tabs'
  ].join(', ');

  var api = null;
  var phase = 'idle';
  var waiting = [];
  var timer = null;

  function isSketch() {
    return main.getAttribute('data-skin') === 'sketch';
  }

  function skinLink() {
    return document.querySelector('link[data-mk-skin]') || document.getElementById('mk-skin');
  }

  function announce() {
    try {
      document.dispatchEvent(new window.CustomEvent('mkchange', { detail: { skin: 'wire' } }));
    } catch (err) {
      // A browser without CustomEvent keeps the attribute and loses the event.
    }
  }

  // ------------------------------------------------------------- loading --

  function fallback() {
    phase = 'failed';
    var link = skinLink();
    main.setAttribute('data-skin', 'wire');
    if (link && link.href) {
      link.href = new window.URL('wire.css', link.href).href;
    }
    var select = document.querySelector('select[data-mk="skin"]');
    if (select) {
      select.value = 'wire';
    }
    announce();
  }

  function settle(found) {
    var callbacks = waiting;
    waiting = [];
    if (found && typeof found.svg === 'function') {
      api = found;
      phase = 'ready';
      for (var i = 0; i < callbacks.length; i += 1) {
        callbacks[i]();
      }
      return;
    }
    fallback();
  }

  function ensure(done) {
    if (phase === 'ready') {
      if (done) {
        done();
      }
      return;
    }
    if (phase === 'failed') {
      return;
    }
    if (done) {
      waiting.push(done);
    }
    if (phase === 'loading') {
      return;
    }
    phase = 'loading';
    var script = document.createElement('script');
    script.src = ROUGH_URL;
    script.async = true;
    script.onload = function () {
      settle(window.rough || null);
    };
    script.onerror = function () {
      settle(null);
    };
    document.head.appendChild(script);
    window.setTimeout(function () {
      if (phase === 'loading') {
        settle(window.rough || null);
      }
    }, 8000);
  }

  // -------------------------------------------------------------- drawing --

  function token(node, name, fallbackValue) {
    var value = window.getComputedStyle(node).getPropertyValue(name);
    value = value === null ? '' : value.trim();
    return value === '' ? fallbackValue : value;
  }

  function seedFor(node, index) {
    var text = String(node.className || '') + '|' + String(node.textContent || '').slice(0, 24);
    var hash = (2166136261 ^ (index + 1)) >>> 0;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash % 100000;
  }

  function paint(ctx) {
    var node = ctx.node;
    var svg = ctx.svg;
    var rc = ctx.rc;
    var x = ctx.x;
    var y = ctx.y;
    var w = ctx.w;
    var h = ctx.h;
    var seed = ctx.seed;
    var cls = node.classList;
    var ink = token(node, '--mk-line', '#3a3a3a');
    var accent = token(node, '--mk-accent', '#1f4fd8');
    var base = {
      seed: seed,
      stroke: ink,
      strokeWidth: 1.3,
      roughness: 1.05,
      bowing: 1,
      preserveVertices: true
    };
    var i;
    var options;

    function add(shape) {
      if (shape) {
        svg.appendChild(shape);
      }
    }

    if (cls.contains('wf-text')) {
      if (node.childElementCount === 0 && String(node.textContent || '').trim() === '') {
        var lines = parseInt(node.getAttribute('data-lines') || '2', 10);
        if (!(lines > 0)) {
          lines = 2;
        }
        var step = h / lines;
        for (i = 0; i < lines; i += 1) {
          var lineY = y + step * i + step * 0.62;
          var ratio = i === lines - 1 && lines > 2 ? 0.58 : 0.94;
          options = {
            seed: seed + i * 13,
            stroke: ink,
            strokeWidth: 1.1,
            roughness: 0.9,
            bowing: 0.8
          };
          add(rc.line(x, lineY, x + w * ratio, lineY, options));
        }
      }
      return;
    }

    if (cls.contains('wf-heading')) {
      if (String(node.textContent || '').trim() === '') {
        options = { seed: seed, stroke: ink, strokeWidth: 3, roughness: 0.8, bowing: 0.6 };
        add(rc.line(x, y + h / 2, x + w, y + h / 2, options));
      }
      return;
    }

    if (cls.contains('wf-image')) {
      add(rc.rectangle(x, y, w, h, base));
      add(rc.line(x, y, x + w, y + h, { seed: seed + 1, stroke: ink, strokeWidth: 1, roughness: 0.9 }));
      add(rc.line(x + w, y, x, y + h, { seed: seed + 2, stroke: ink, strokeWidth: 1, roughness: 0.9 }));
      return;
    }

    if (cls.contains('wf-avatar')) {
      add(rc.circle(x + w / 2, y + h / 2, Math.min(w, h), base));
      return;
    }

    if (cls.contains('wf-checkbox')) {
      add(rc.rectangle(x, y, w, h, base));
      if (node.getAttribute('data-checked') === 'true') {
        add(rc.line(x + w * 0.2, y + h * 0.55, x + w * 0.45, y + h * 0.8, {
          seed: seed + 3,
          stroke: accent,
          strokeWidth: 1.8,
          roughness: 0.8
        }));
        add(rc.line(x + w * 0.45, y + h * 0.8, x + w * 0.85, y + h * 0.2, {
          seed: seed + 4,
          stroke: accent,
          strokeWidth: 1.8,
          roughness: 0.8
        }));
      }
      return;
    }

    if (cls.contains('wf-toggle')) {
      add(rc.rectangle(x, y, w, h, base));
      var knob = Math.min(h - 8, 14);
      var knobX = cls.contains('on') ? x + w - knob - 4 : x + 4;
      add(rc.circle(knobX + knob / 2, y + h / 2, knob, {
        seed: seed + 5,
        stroke: ink,
        strokeWidth: 1.2,
        roughness: 0.9
      }));
      return;
    }

    if (cls.contains('wf-button')) {
      // A primary button is the same pencil in a heavier hand, not a fill: a
      // hatch of accent under accent text cannot be read.
      var primary = cls.contains('primary');
      options = {
        seed: seed,
        stroke: primary ? accent : ink,
        strokeWidth: primary ? 2.2 : 1.3,
        roughness: 0.9,
        bowing: 1
      };
      add(rc.rectangle(x, y, w, h, options));
      return;
    }

    if (cls.contains('wf-table')) {
      add(rc.rectangle(x, y, w, h, base));
      var rows = parseInt(node.getAttribute('data-rows') || '4', 10);
      var cols = parseInt(node.getAttribute('data-cols') || '3', 10);
      if (!(rows > 0)) {
        rows = 4;
      }
      if (!(cols > 0)) {
        cols = 3;
      }
      for (i = 1; i < rows; i += 1) {
        var ry = y + (h / rows) * i;
        add(rc.line(x, ry, x + w, ry, {
          seed: seed + i * 7,
          stroke: ink,
          strokeWidth: 0.9,
          roughness: 0.7
        }));
      }
      for (i = 1; i < cols; i += 1) {
        var cx = x + (w / cols) * i;
        add(rc.line(cx, y, cx, y + h, {
          seed: seed + i * 11,
          stroke: ink,
          strokeWidth: 0.9,
          roughness: 0.7
        }));
      }
      return;
    }

    if (cls.contains('wf-chart')) {
      add(rc.line(x, y, x, y + h, { seed: seed + 1, stroke: ink, strokeWidth: 1.1, roughness: 0.8 }));
      add(rc.line(x, y + h, x + w, y + h, { seed: seed + 2, stroke: ink, strokeWidth: 1.1, roughness: 0.8 }));
      for (i = 0; i < node.children.length; i += 1) {
        var bar = node.children[i];
        var barRect = bar.getBoundingClientRect();
        if (barRect.width === 0 || barRect.height === 0) {
          continue;
        }
        var bx = (barRect.left - ctx.origin.left) * ctx.k;
        var by = (barRect.top - ctx.origin.top) * ctx.k;
        var bw = barRect.width * ctx.k;
        var bh = barRect.height * ctx.k;
        add(
          rc.rectangle(bx, by, bw, bh, {
            seed: seedFor(bar, i),
            stroke: bar.classList.contains('is-accent') ? accent : ink,
            strokeWidth: 1.2,
            roughness: 1,
            fill: bar.classList.contains('is-accent') ? accent : undefined,
            fillStyle: 'hachure',
            hachureGap: 6,
            hachureAngle: -41
          })
        );
      }
      return;
    }

    // Everything else is a rectangle: a box, a card, a field, a bar, a window.
    add(rc.rectangle(x, y, w, h, base));
  }

  function roughLayer(screen) {
    for (var c = 0; c < screen.children.length; c += 1) {
      if (screen.children[c].classList.contains('mk-rough')) {
        return screen.children[c];
      }
    }
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'mk-rough');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    screen.appendChild(svg);
    return svg;
  }

  function drawScreen(screen) {
    var width = screen.offsetWidth;
    var height = screen.offsetHeight;
    if (width === 0 || height === 0) {
      return;
    }
    var origin = screen.getBoundingClientRect();
    var k = origin.width === 0 ? 1 : width / origin.width;
    var nodes = screen.querySelectorAll(SELECTOR);
    // A modal or a toast has a background of its own, so it gets a pencil layer
    // of its own: one layer per screen would draw its contents under its paper.
    var layers = [];
    var byHost = new Map();
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.getClientRects().length === 0) {
        continue;
      }
      var rect = node.getBoundingClientRect();
      if (rect.width * k < 3 || rect.height * k < 3) {
        continue;
      }
      var host = node.closest('.wf-modal, .wf-toast');
      if (host === null || host === undefined || host === screen) {
        host = screen;
      }
      var bucket = byHost.get(host);
      if (bucket === undefined) {
        bucket = [];
        byHost.set(host, bucket);
        layers.push(host);
      }
      bucket.push({ node: node, rect: rect, seed: seedFor(node, i) });
    }
    for (var l = 0; l < layers.length; l += 1) {
      drawLayer(layers[l], byHost.get(layers[l]), k);
    }
  }

  function drawLayer(host, items, k) {
    var width = host.offsetWidth;
    var height = host.offsetHeight;
    if (width === 0 || height === 0) {
      return;
    }
    var svg = roughLayer(host);
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('preserveAspectRatio', 'none');
    var rc = api.svg(svg);
    var origin = host.getBoundingClientRect();
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      paint({
        node: item.node,
        svg: svg,
        rc: rc,
        x: (item.rect.left - origin.left) * k,
        y: (item.rect.top - origin.top) * k,
        w: item.rect.width * k,
        h: item.rect.height * k,
        seed: item.seed,
        origin: origin,
        k: k
      });
    }
  }

  function draw() {
    if (api === null || !isSketch()) {
      return;
    }
    var screens = main.querySelectorAll('.mk-screen');
    for (var s = 0; s < screens.length; s += 1) {
      drawScreen(screens[s]);
    }
  }

  function schedule(delay) {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(function () {
      timer = null;
      draw();
    }, delay === undefined ? 80 : delay);
  }

  function start() {
    if (!isSketch()) {
      return;
    }
    ensure(function () {
      draw();
    });
  }

  // --------------------------------------------------------------- wiring --

  document.addEventListener('mkchange', function () {
    if (isSketch()) {
      start();
      schedule(120);
    }
  });

  window.addEventListener('resize', function () {
    if (isSketch()) {
      schedule(140);
    }
  });

  document.addEventListener('transitionend', function () {
    if (isSketch()) {
      schedule(140);
    }
  });

  if (typeof window.MutationObserver === 'function') {
    var observer = new window.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i += 1) {
        var target = records[i].target;
        if (target && target.closest && target.closest('.mk-rough')) {
          continue;
        }
        if (isSketch()) {
          schedule(150);
        }
        return;
      }
    });
    observer.observe(main, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-state', 'data-skin', 'data-view'],
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
