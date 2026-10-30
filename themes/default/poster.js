/*
 * rshow theme "default": poster runtime. One optional dependency:
 * qrcode-generator, loaded before this file.
 *
 * Markup: <div class="poster-stage"><div class="poster" data-size="a0">...</div></div>
 * with a toolbar of [data-poster-size] buttons and one [data-poster-print].
 *
 *   .poster[data-size]   a0, a1, 36x48 or 48x36, read back as --poster-w and
 *                        --poster-h, which this file writes into one @page rule
 *                        so print is exactly one page of that size.
 *   [data-qr]            an element that should carry a QR code for its URL.
 *                        The code is an inline SVG from qrcode-generator; when
 *                        the library is missing the element keeps the plain
 *                        address it already holds and gets .poster-qr--text.
 *   [data-poster-status] one line of words naming the current sheet.
 *
 * On screen the poster is scaled to the width of the window and scaled again on
 * every resize, so a reader sees the whole poster and never a reflowed one.
 *
 * A size can also be named in the address, ?size=a1, which is how an automated
 * print picks a sheet without clicking; changing the size from the toolbar
 * writes the same parameter back with replaceState, so a reload prints the sheet
 * on screen. */
(function () {
  'use strict';

  var EDGE = 24;
  var WORDS = {
    a0: 'A0, 841 mm wide x 1189 mm tall, three columns',
    a1: 'A1, 594 mm wide x 841 mm tall, three columns',
    '36x48': '36x48 sheet, landscape: 48 in wide x 36 in tall, four columns',
    '48x36': '48x36 sheet, portrait: 36 in wide x 48 in tall, three columns'
  };

  var poster = document.querySelector('.poster');
  if (!poster) {
    return;
  }
  var stage = poster.parentNode;
  var status = document.querySelector('[data-poster-status]');
  var frame = 0;

  // ------------------------------------------------------------- QR code --

  function noCode(host) {
    host.classList.add('poster-qr--text');
  }

  function renderQr(host) {
    var url = (host.getAttribute('data-qr') || '').replace(/^\s+|\s+$/g, '');
    if (url === '') {
      return;
    }
    if (typeof window.qrcode !== 'function') {
      noCode(host);
      return;
    }
    var svg;
    try {
      var code = window.qrcode(0, 'M');
      code.addData(url);
      code.make();
      var box = document.createElement('div');
      box.innerHTML = code.createSvgTag({
        cellSize: 8,
        margin: 32,
        scalable: true,
        alt: 'QR code for ' + url
      });
      svg = box.firstChild;
    } catch (err) {
      noCode(host);
      return;
    }
    if (!svg || svg.nodeType !== 1) {
      noCode(host);
      return;
    }
    host.insertBefore(svg, host.firstChild);
    host.classList.remove('poster-qr--text');
  }

  // ------------------------------------------------------------ page size --

  // CSS holds the sheet and its columns; the two values travel to @page so the
  // numbers live in one place. A stylesheet rule beats the a0 default in
  // poster.css because this element is appended last.
  function pageSize() {
    var rule = document.getElementById('poster-page-size');
    if (!rule) {
      rule = document.createElement('style');
      rule.id = 'poster-page-size';
      (document.head || document.documentElement).appendChild(rule);
    }
    var computed = window.getComputedStyle(poster);
    var width = (computed.getPropertyValue('--poster-w') || '').replace(/^\s+|\s+$/g, '');
    var height = (computed.getPropertyValue('--poster-h') || '').replace(/^\s+|\s+$/g, '');
    rule.textContent = width !== '' && height !== ''
      ? '@page{size:' + width + ' ' + height + ';margin:0}'
      : '';
  }

  // --------------------------------------------------------------- scale --

  function fit() {
    var width = poster.offsetWidth;
    var height = poster.offsetHeight;
    if (width === 0 || height === 0) {
      return;
    }
    var view = document.documentElement.clientWidth || window.innerWidth || width;
    var scale = Math.min(1, (view - EDGE * 2) / width);
    if (!(scale > 0)) {
      scale = 1;
    }
    // offsetWidth is the layout width, so a scaled poster still reports the
    // sheet and not the frame it is drawn in.
    poster.style.transform = 'scale(' + scale + ')';
    if (stage) {
      stage.style.width = Math.round(width * scale) + 'px';
      stage.style.height = Math.round(height * scale) + 'px';
    }
  }

  function queueFit() {
    if (frame !== 0) {
      return;
    }
    frame = window.requestAnimationFrame(function () {
      frame = 0;
      fit();
    });
  }

  // --------------------------------------------------------------- sizes --

  function known(size) {
    return Object.prototype.hasOwnProperty.call(WORDS, size) ? size : '';
  }

  // ?size=a1 picks the sheet before the first paint, so a print command on a
  // headless browser does not have to click a button first.
  function asked() {
    var match = /[?&]size=([a-z0-9]+)/i.exec(window.location.search || '');
    return match ? known(match[1].toLowerCase()) : '';
  }

  // The address keeps the sheet, so a reload and a print of the window agree.
  function remember(size) {
    if (typeof window.history.replaceState !== 'function') {
      return;
    }
    try {
      var query = (window.location.search || '').replace(/[?&]size=[a-z0-9]+/i, '');
      var keep = query.replace(/^&/, '?');
      var next = keep + (keep === '' ? '?' : '&') + 'size=' + size;
      window.history.replaceState(null, '', next + (window.location.hash || ''));
    } catch (err) {
      // A file:// page or a sandboxed frame may refuse; the sheet still changes.
    }
  }

  function setSize(size, silent) {
    var next = known(size) || known(poster.getAttribute('data-size')) || 'a0';
    if (poster.getAttribute('data-size') !== next) {
      poster.setAttribute('data-size', next);
    }
    var buttons = document.querySelectorAll('[data-poster-size]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute(
        'aria-pressed',
        buttons[i].getAttribute('data-poster-size') === next ? 'true' : 'false'
      );
    }
    if (status) {
      status.textContent = WORDS[next] || next;
    }
    pageSize();
    fit();
    if (!silent) {
      remember(next);
    }
  }

  function onSize(event) {
    setSize(event.currentTarget.getAttribute('data-poster-size'));
  }

  var sizes = document.querySelectorAll('[data-poster-size]');
  for (var s = 0; s < sizes.length; s += 1) {
    sizes[s].addEventListener('click', onSize);
  }

  var printButton = document.querySelector('[data-poster-print]');
  if (printButton) {
    printButton.addEventListener('click', function () {
      window.print();
    });
  }

  var hosts = document.querySelectorAll('[data-qr]');
  for (var q = 0; q < hosts.length; q += 1) {
    renderQr(hosts[q]);
  }

  // Boot is silent: the first paint must not rewrite the address it was opened at.
  setSize(asked() || poster.getAttribute('data-size'), true);

  window.addEventListener('resize', queueFit);
  window.addEventListener('orientationchange', queueFit);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      fit();
    });
  }

  if (typeof window.ResizeObserver === 'function') {
    new window.ResizeObserver(queueFit).observe(poster);
  }

  queueFit();
}());
