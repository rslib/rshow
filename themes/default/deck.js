/*
 * rshow theme "default" deck runtime. Zero dependencies.
 *
 * Markup: <main class="deck"><section class="slide">...</section>...</main>
 * Keys: arrows, space, PageUp/PageDown, Home/End, f = fullscreen, n = notes,
 * p = presenter view, t = mode (system, light, dark).
 * Mouse: click advances, shift-click goes back, swipe left/right navigates.
 * URL hash #N keeps the slide. Steps reveal one per advance.
 *
 * Mode. The deck and a page share one storage key, "rshow-mode", holding
 * light, dark or system. The attribute on <html> does the work; tokens.css
 * carries both palettes. A deck opened before this script runs shows the system
 * mode for one frame, which is why the example links nothing that depends on
 * the mode before the canvas paints. Print is always light.
 */
(function () {
  'use strict';

  var CANVAS_W = 1280;
  var CANVAS_H = 720;

  // -------------------------------------------------------------- mode --
  var MODE_KEY = 'rshow-mode';
  var MODES = ['system', 'light', 'dark'];

  function readMode() {
    try {
      var value = window.localStorage.getItem(MODE_KEY);
      return MODES.indexOf(value) === -1 ? 'system' : value;
    } catch (err) {
      return 'system';
    }
  }

  function writeMode(mode) {
    try {
      if (mode === 'system') {
        window.localStorage.removeItem(MODE_KEY);
      } else {
        window.localStorage.setItem(MODE_KEY, mode);
      }
    } catch (err) {
      // Storage is refused in private windows and on file://; the mode still
      // applies for this document.
    }
  }

  function applyMode(mode) {
    var root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-mode');
    } else {
      root.setAttribute('data-mode', mode);
    }
  }

  function modeName(mode) {
    if (mode === 'light') {
      return 'Light';
    }
    if (mode === 'dark') {
      return 'Dark';
    }
    return 'System';
  }

  function modeAttr() {
    var mode = readMode();
    return mode === 'system' ? '' : ' data-mode="' + mode + '"';
  }

  applyMode(readMode());

  // The notes and presenter windows are separate documents, so they cannot
  // inherit the deck's stylesheet. They read the theme tokens off the deck and
  // fall back to the Carbon white values when no tokens.css was linked.
  var FALLBACK = {
    bg: '#ffffff',
    layer: '#f4f4f4',
    fg: '#161616',
    muted: '#525252',
    border: '#e0e0e0',
    accent: '#0f62fe',
    fontSans: 'system-ui, sans-serif',
    fontMono: 'ui-monospace, monospace'
  };

  function token(name, fallback) {
    var value = '';
    try {
      value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    } catch (err) {
      value = '';
    }
    value = String(value || '').replace(/^\s+|\s+$/g, '');
    return value || fallback;
  }

  function notesCss() {
    var bg = token('--bg', FALLBACK.bg);
    var fg = token('--fg', FALLBACK.fg);
    var muted = token('--muted', FALLBACK.muted);
    var border = token('--border-subtle', FALLBACK.border);
    var sans = token('--font-sans', FALLBACK.fontSans);
    var mono = token('--font-mono', FALLBACK.fontMono);
    return [
      '<style>',
      'html,body{margin:0;height:100%}',
      'body{background:' + bg + ';color:' + fg + ';font:18px/1.5 ' + sans + '}',
      'header{padding:14px 24px;border-bottom:1px solid ' + border + ';',
      'font-size:14px;color:' + muted + ';display:flex;gap:16px}',
      'main{padding:24px;font-size:24px;line-height:1.5;overflow:auto;height:calc(100% - 108px)}',
      'main p{margin:0 0 14px}',
      'main ul{margin:0 0 14px;padding-left:22px}',
      'main code{font-family:' + mono + ';font-size:.9em}',
      '.empty{color:' + muted + '}',
      'footer{position:fixed;left:0;right:0;bottom:0;padding:12px 24px;',
      'border-top:1px solid ' + border + ';font-size:13px;',
      'color:' + muted + ';display:flex;justify-content:space-between;gap:16px;',
      'background:' + bg + '}',
      '<' + '/style>'
    ].join('');
  }

  var deck = document.querySelector('main.deck');
  if (!deck) {
    return;
  }

  var slides = [];
  var i;
  for (i = 0; i < deck.children.length; i += 1) {
    if (deck.children[i].classList && deck.children[i].classList.contains('slide')) {
      slides.push(deck.children[i]);
    }
  }
  if (slides.length === 0) {
    return;
  }

  var current = 0;
  var revealed = [];
  var notesWindow = null;
  var presenterWindow = null;
  var hud = null;
  var startedAt = Date.now();

  for (i = 0; i < slides.length; i += 1) {
    revealed.push(0);
  }

  function stepsOf(n) {
    return slides[n].querySelectorAll('.step');
  }

  function clamp(n) {
    if (n < 0) {
      return 0;
    }
    if (n > slides.length - 1) {
      return slides.length - 1;
    }
    return n;
  }

  function fit() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var scale = Math.min(w / CANVAS_W, h / CANVAS_H);
    if (!isFinite(scale) || scale <= 0) {
      scale = 1;
    }
    var x = Math.round((w - CANVAS_W * scale) / 2);
    var y = Math.round((h - CANVAS_H * scale) / 2);
    deck.style.left = '0';
    deck.style.top = '0';
    deck.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + scale + ')';
  }

  function writeHash() {
    var want = '#' + (current + 1);
    if (window.location.hash === want) {
      return;
    }
    try {
      window.history.replaceState(null, '', want);
    } catch (err) {
      window.location.hash = want;
    }
  }

  function slideTitle(n) {
    var h = slides[n].querySelector('h1, h2, h3');
    var text = h ? h.textContent : '';
    text = text.replace(/\s+/g, ' ').replace(/^ +| +$/g, '');
    return text || 'Slide ' + (n + 1);
  }

  function syncHud() {
    if (hud) {
      hud.textContent = (current + 1) + ' / ' + slides.length;
    }
  }

  // The mode name takes the HUD for a moment, then the counter comes back.
  var hudTimer = null;

  function flashHud(text) {
    if (!hud) {
      return;
    }
    hud.textContent = text;
    if (hudTimer) {
      window.clearTimeout(hudTimer);
    }
    hudTimer = window.setTimeout(function () {
      hudTimer = null;
      syncHud();
    }, 1200);
  }

  function cycleMode() {
    var mode = window.rshowMode && typeof window.rshowMode.get === 'function'
      ? window.rshowMode.get()
      : readMode();
    var next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    if (window.rshowMode && typeof window.rshowMode.set === 'function') {
      window.rshowMode.set(next);
    } else {
      writeMode(next);
    }
    applyMode(next);
    flashHud(modeName(next));
  }

  function slideHtml(n) {
    if (n < 0 || n > slides.length - 1) {
      return '';
    }
    var copy = slides[n].cloneNode(true);
    copy.classList.remove('is-active');
    copy.removeAttribute('aria-hidden');
    var notes = copy.querySelector('aside.notes');
    if (notes) {
      notes.parentNode.removeChild(notes);
    }
    return copy.outerHTML;
  }

  function notesHtml(n) {
    var aside = slides[n] ? slides[n].querySelector('aside.notes') : null;
    return aside ? aside.innerHTML : '<p class="empty">No notes on this slide.</p>';
  }

  function syncNotes() {
    if (!notesWindow || notesWindow.closed) {
      return;
    }
    var doc = notesWindow.document;
    var pos = doc.getElementById('pos');
    var title = doc.getElementById('title');
    var body = doc.getElementById('notes');
    var nextUp = doc.getElementById('next-up');
    if (!pos || !title || !body) {
      return;
    }
    pos.textContent = (current + 1) + ' / ' + slides.length;
    title.textContent = slideTitle(current);
    body.innerHTML = notesHtml(current);
    if (nextUp) {
      nextUp.textContent = current < slides.length - 1
        ? 'Next: ' + slideTitle(current + 1)
        : 'Last slide';
    }
  }

  // The presenter window is same origin and was written by this document, so
  // the deck calls a function on it directly instead of posting messages.
  function syncPresenter() {
    if (!presenterWindow || presenterWindow.closed || !presenterWindow.rshowPresenterUpdate) {
      return;
    }
    presenterWindow.rshowPresenterUpdate({
      index: current + 1,
      total: slides.length,
      start: startedAt,
      title: slideTitle(current),
      nextTitle: current < slides.length - 1 ? slideTitle(current + 1) : '',
      current: slideHtml(current),
      next: slideHtml(current + 1),
      notes: notesHtml(current)
    });
  }

  function render() {
    var k;
    var steps;
    var j;
    for (k = 0; k < slides.length; k += 1) {
      var isCurrent = k === current;
      slides[k].classList.toggle('is-active', isCurrent);
      slides[k].setAttribute('aria-hidden', isCurrent ? 'false' : 'true');
      steps = slides[k].querySelectorAll('.step');
      for (j = 0; j < steps.length; j += 1) {
        steps[j].classList.toggle('is-revealed', j < revealed[k]);
      }
    }
    syncHud();
    writeHash();
    syncNotes();
    syncPresenter();
    if (reading) {
      scrollToCurrent();
    }
  }

  function go(n) {
    current = clamp(n);
    revealed[current] = stepsOf(current).length;
    render();
  }

  function next() {
    if (revealed[current] < stepsOf(current).length) {
      revealed[current] += 1;
      render();
      return;
    }
    if (current < slides.length - 1) {
      current += 1;
      render();
    }
  }

  function prev() {
    if (revealed[current] > 0) {
      revealed[current] -= 1;
      render();
      return;
    }
    if (current > 0) {
      current -= 1;
      revealed[current] = stepsOf(current).length;
      render();
    }
  }

  function first() {
    current = 0;
    revealed[0] = 0;
    render();
  }

  function last() {
    current = slides.length - 1;
    revealed[current] = stepsOf(current).length;
    render();
  }

  function openNotes() {
    if (notesWindow && !notesWindow.closed) {
      notesWindow.focus();
      return;
    }
    notesWindow = window.open('', 'rshow-deck-notes', 'width=680,height=560');
    if (!notesWindow) {
      return;
    }
    var doc = notesWindow.document;
    doc.open();
    doc.write('<!doctype html><html' + modeAttr() + '><head><meta charset="utf-8">' +
      '<title>Speaker notes</title>' + notesCss() + '</head><body>' +
      '<header><span id="pos"></span><span id="title"></span></header>' +
      '<main id="notes"></main>' +
      '<footer><span id="next-up"></span>' +
      '<span>Arrows navigate, n closes</span></footer></body></html>');
    doc.close();
    doc.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'ArrowRight' || key === 'ArrowDown' || key === ' ' || key === 'PageDown') {
        next();
        event.preventDefault();
      } else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') {
        prev();
        event.preventDefault();
      } else if (key === 'n' || key === 'N') {
        if (notesWindow) {
          notesWindow.close();
        }
      }
    });
    syncNotes();
    notesWindow.focus();
  }

  // The presenter view: current slide, next slide, the notes of the current
  // slide, a counter and an elapsed timer. The deck writes the document and
  // hands it the stylesheets the deck itself linked, so the two windows render
  // the same slide the same way.
  function presenterHead() {
    var links = document.querySelectorAll('link[rel~="stylesheet"]');
    var head = [];
    var k;
    for (k = 0; k < links.length; k += 1) {
      head.push('<link rel="stylesheet" href="' + links[k].href + '">');
    }
    var styles = document.querySelectorAll('style');
    for (k = 0; k < styles.length; k += 1) {
      head.push('<style>' + styles[k].textContent + '</style>');
    }
    return head.join('');
  }

  function presenterCss() {
    var bg = token('--bg', FALLBACK.bg);
    var layer = token('--layer-01', FALLBACK.layer);
    var fg = token('--fg', FALLBACK.fg);
    var muted = token('--muted', FALLBACK.muted);
    var border = token('--border-subtle', FALLBACK.border);
    var sans = token('--font-sans', FALLBACK.fontSans);
    return [
      '<style>',
      'html,body{margin:0;height:100%}',
      'body{background:' + bg + ';color:' + fg + ';font:16px/1.45 ' + sans + ';',
      'display:flex;flex-direction:column;overflow:hidden}',
      'header{display:flex;justify-content:space-between;align-items:baseline;',
      'padding:14px 24px;border-bottom:1px solid ' + border + ';font-size:14px;color:' + muted + '}',
      '#timer{font-variant-numeric:tabular-nums;font-size:20px;color:' + fg + '}',
      'main{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px;',
      'flex:1;min-height:0;overflow:auto;align-content:start}',
      '.pane{min-width:0}',
      '.pane-label{margin:0 0 10px;font-size:14px;font-weight:400;color:' + muted + '}',
      '.frame{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:' + layer + '}',
      '.frame > main.deck{position:absolute;top:0;left:0;transform-origin:0 0;transform:none;',
      'width:1280px;height:720px;margin:0}',
      '.notes{grid-column:1 / -1;background:' + layer + ';padding:20px 24px;font-size:22px;line-height:1.45}',
      '.notes p{margin:0 0 12px}',
      '.notes ul{margin:0 0 12px;padding-left:22px}',
      '.notes .empty{color:' + muted + '}',
      'footer{padding:10px 24px;border-top:1px solid ' + border + ';font-size:13px;color:' + muted + '}',
      '<' + '/style>'
    ].join('');
  }

  function fitPresented() {
    if (!presenterWindow || presenterWindow.closed) {
      return;
    }
    var doc = presenterWindow.document;
    var frames = doc.querySelectorAll('.frame');
    var k;
    for (k = 0; k < frames.length; k += 1) {
      var inner = frames[k].querySelector('main.deck');
      if (!inner) {
        continue;
      }
      var scale = frames[k].clientWidth / CANVAS_W;
      inner.style.transform = 'scale(' + (isFinite(scale) && scale > 0 ? scale : 1) + ')';
    }
  }

  function openPresenter() {
    if (presenterWindow && !presenterWindow.closed) {
      presenterWindow.focus();
      return;
    }
    presenterWindow = window.open('', 'rshow-deck-presenter', 'width=1160,height=900');
    if (!presenterWindow) {
      return;
    }
    var doc = presenterWindow.document;
    doc.open();
    doc.write('<!doctype html><html' + modeAttr() + '><head><meta charset="utf-8">' +
      '<title>Presenter view</title>' + presenterHead() + presenterCss() +
      '</head><body>' +
      '<header><span id="counter"></span><span id="timer">00:00</span></header>' +
      '<main>' +
      '<section class="pane"><p class="pane-label">Current slide</p>' +
      '<div class="frame" id="frame-current"></div></section>' +
      '<section class="pane"><p class="pane-label">Next slide</p>' +
      '<div class="frame" id="frame-next"></div></section>' +
      '<section class="pane notes"><p class="pane-label">Notes</p>' +
      '<div id="notes"></div></section>' +
      '</main>' +
      '<footer>Arrows advance, f fullscreen, p closes</footer>' +
      '</body></html>');
    doc.close();

    var start = startedAt;
    presenterWindow.rshowPresenterUpdate = function (state) {
      var counter = doc.getElementById('counter');
      var notes = doc.getElementById('notes');
      var cur = doc.getElementById('frame-current');
      var nxt = doc.getElementById('frame-next');
      if (!counter || !notes || !cur || !nxt) {
        return;
      }
      start = state.start || start;
      counter.textContent = (state.index + ' / ' + state.total) + '  ' + state.title;
      cur.innerHTML = state.current ? '<main class="deck">' + state.current + '</main>' : '';
      nxt.innerHTML = state.next
        ? '<main class="deck">' + state.next + '</main>'
        : '<p style="padding:24px;font-size:20px">Last slide</p>';
      notes.innerHTML = state.notes;
      fitPresented();
    };

    function tick() {
      var timer = doc.getElementById('timer');
      if (!timer) {
        return;
      }
      var seconds = Math.floor((Date.now() - start) / 1000);
      if (seconds < 0) {
        seconds = 0;
      }
      var mm = Math.floor(seconds / 60);
      var ss = seconds % 60;
      timer.textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
    }

    presenterWindow.setInterval(tick, 1000);
    tick();

    doc.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'ArrowRight' || key === 'ArrowDown' || key === ' ' || key === 'PageDown') {
        next();
        event.preventDefault();
      } else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') {
        prev();
        event.preventDefault();
      } else if (key === 'p' || key === 'P') {
        if (presenterWindow) {
          presenterWindow.close();
        }
      }
    });

    presenterWindow.addEventListener('resize', function () {
      fitPresented();
    });

    syncPresenter();
    presenterWindow.focus();
  }

  function toggleFullscreen() {
    var doc = document;
    var root = doc.documentElement;
    var active = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (active) {
      if (doc.exitFullscreen) {
        doc.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    } else if (root.requestFullscreen) {
      var request = root.requestFullscreen();
      if (request && request.catch) {
        request.catch(function () {});
      }
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    }
    setTimeout(fit, 120);
  }

  function isTyping(event) {
    var target = event.target;
    if (!target || !target.tagName) {
      return false;
    }
    var tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) {
      return;
    }
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
      case 'Spacebar':
        next();
        event.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        prev();
        event.preventDefault();
        break;
      case 'Home':
        first();
        event.preventDefault();
        break;
      case 'End':
        last();
        event.preventDefault();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        event.preventDefault();
        break;
      case 'n':
      case 'N':
        openNotes();
        event.preventDefault();
        break;
      case 'p':
      case 'P':
        openPresenter();
        event.preventDefault();
        break;
      case 't':
      case 'T':
        cycleMode();
        event.preventDefault();
        break;
      case 'Escape':
        // Out of one slide at a time, back to the stack the phone reads.
        if (reading || forced !== null) {
          forced = null;
          setReading(wantsReading());
          event.preventDefault();
        }
        break;
      default:
        break;
    }
  });

  deck.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== deck) {
      if (node.tagName === 'A' || node.tagName === 'BUTTON' || node.tagName === 'INPUT') {
        return;
      }
      node = node.parentNode;
    }
    if (event.shiftKey) {
      prev();
    } else {
      next();
    }
  });

  var touchX = 0;
  var touchY = 0;
  var tracking = false;

  document.addEventListener('touchstart', function (event) {
    if (event.touches.length !== 1) {
      tracking = false;
      return;
    }
    tracking = true;
    touchX = event.touches[0].clientX;
    touchY = event.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function (event) {
    if (!tracking) {
      return;
    }
    tracking = false;
    var touch = event.changedTouches && event.changedTouches[0];
    if (!touch) {
      return;
    }
    var dx = touch.clientX - touchX;
    var dy = touch.clientY - touchY;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        next();
      } else {
        prev();
      }
    }
  }, { passive: true });

  // ------------------------------------------------------------- reading --

  // A phone held upright has no room for a 1280 x 720 canvas: the slide arrives
  // as a 390 x 219 strip. deck.css stacks every slide down the page as a block
  // at the width of the screen and reflows its type, so there is no scale to
  // work out here; this is the part that decides when, and the small fixed
  // button and Esc are how a reader switches.
  var READING = window.matchMedia
    ? window.matchMedia('(max-width: 699px) and (orientation: portrait)')
    : null;
  var reading = false;
  var forced = null; // 'read', 'present', or null for whatever the device is
  var toggleButton = null;

  function wantsReading() {
    if (forced === 'read') {
      return true;
    }
    if (forced === 'present') {
      return false;
    }
    return READING !== null && READING.matches;
  }

  function scrollToCurrent() {
    if (!slides[current]) {
      return;
    }
    var box = slides[current].getBoundingClientRect();
    var top = (window.pageYOffset || document.documentElement.scrollTop || 0) + box.top;
    window.scrollTo(0, top);
  }

  // Scrolling the stack is navigating it: the slide at the top of the window is
  // the current one, so the counter and the URL follow the reader.
  function followScroll() {
    if (!reading) {
      return;
    }
    var top = window.pageYOffset || document.documentElement.scrollTop || 0;
    var at = 0;
    var k;
    var box;
    for (k = 0; k < slides.length; k += 1) {
      box = slides[k].getBoundingClientRect();
      if (box.top <= 4) {
        at = k;
      }
    }
    if (top + window.innerHeight >= document.documentElement.scrollHeight - 4) {
      at = slides.length - 1;
    }
    if (at === current) {
      return;
    }
    current = at;
    syncHud();
    writeHash();
    syncNotes();
    syncPresenter();
  }

  function syncToggle() {
    if (!toggleButton) {
      return;
    }
    toggleButton.hidden = !reading && forced !== 'present';
    toggleButton.textContent = reading ? 'Present' : 'Read';
    toggleButton.setAttribute('aria-label', reading
      ? 'Present: one slide at a time, Esc comes back to reading'
      : 'Read: every slide down the page, Esc comes back to presenting');
  }

  function setReading(on) {
    reading = on;
    deck.classList.toggle('is-reading', on);
    document.documentElement.classList.toggle('is-reading', on);
    document.body.classList.toggle('is-reading', on);
    syncToggle();
    if (on) {
      var k;
      // The reader sees the whole deck, so no step waits for a key.
      for (k = 0; k < slides.length; k += 1) {
        revealed[k] = stepsOf(k).length;
      }
      render();
      return;
    }
    fit();
    render();
  }

  function flip(which) {
    forced = which;
    setReading(wantsReading());
  }

  function mountToggle() {
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'deck-present';
    toggleButton.addEventListener('click', function () {
      flip(reading ? 'present' : 'read');
    });
    document.body.appendChild(toggleButton);
    syncToggle();
  }

  if (READING !== null) {
    if (READING.addEventListener) {
      READING.addEventListener('change', function () {
        if (forced === null) {
          setReading(wantsReading());
        }
      });
    } else if (READING.addListener) {
      READING.addListener(function () {
        if (forced === null) {
          setReading(wantsReading());
        }
      });
    }
  }

  var followQueued = false;
  window.addEventListener('scroll', function () {
    if (!reading || followQueued) {
      return;
    }
    followQueued = true;
    var run = function () {
      followQueued = false;
      followScroll();
    };
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(run);
    } else {
      run();
    }
  }, { passive: true });

  var resizeQueued = false;
  function onResize() {
    if (resizeQueued) {
      return;
    }
    resizeQueued = true;
    var run = function () {
      resizeQueued = false;
      // A turn of the phone crosses the reading query: follow it, then lay the
      // deck out for the mode it landed in.
      if (forced === null && wantsReading() !== reading) {
        setReading(wantsReading());
        return;
      }
      if (!reading) {
        fit();
      }
    };
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(run);
    } else {
      run();
    }
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  window.addEventListener('hashchange', function () {
    var match = /^#(\d+)$/.exec(window.location.hash);
    if (!match) {
      return;
    }
    var wanted = clamp(parseInt(match[1], 10) - 1);
    if (wanted === current) {
      return;
    }
    go(wanted);
  });

  function boot() {
    deck.classList.add('is-ready');

    hud = deck.querySelector('.deck-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'deck-hud';
      deck.appendChild(hud);
    }
    hud.setAttribute('aria-hidden', 'true');
    // Reading mode numbers each slide "n / total", and CSS cannot count the
    // deck, so the count is a property the stack reads. content takes a string,
    // so the value carries its quotes and the label prints 3 and not a bare
    // number the counter cannot join.
    deck.style.setProperty('--deck-total', '"' + slides.length + '"');

    var match = /^#(\d+)$/.exec(window.location.hash);
    current = match ? clamp(parseInt(match[1], 10) - 1) : 0;
    revealed[current] = match ? stepsOf(current).length : 0;
    startedAt = Date.now();

    fit();
    render();

    mountToggle();
    setReading(wantsReading());
  }

  window.rshowDeck = {
    go: go,
    next: next,
    prev: prev,
    count: function () {
      return slides.length;
    },
    current: function () {
      return current + 1;
    }
  };

  boot();
}());
