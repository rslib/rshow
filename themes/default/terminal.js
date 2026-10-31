/*
 * rshow theme "default": terminal viewer. Two pinned libraries, loaded from
 * jsDelivr only when a figure needs one of them:
 *
 *   ansi mode   @xterm/xterm@6.0.0
 *               @xterm/xterm@6.0.0/css/xterm.css
 *               @xterm/addon-unicode11@0.9.0   (box drawing and wide glyphs)
 *   cast mode   asciinema-player@3.17.0
 *               asciinema-player@3.17.0 bundle css
 *
 * Markup:
 *
 *   <figure class="terminal" data-mode="ansi" data-src="capture.ans"
 *           data-cols="100" data-rows="30" data-title="procview"
 *           data-palette="default"></figure>
 *   <figure class="terminal" data-mode="cast" data-src="demo.cast"
 *           data-title="rshow publish ./deck"></figure>
 *
 *   data-mode     ansi (a capture of a screen) or cast (an asciicast recording)
 *   data-src      the file, relative to the page
 *   data-cols     the grid the capture was taken on, ansi only
 *   data-rows     and its height
 *   data-title    what goes in the title bar; the file name by default
 *   data-palette  default, dark, light or high-contrast; terminal.css owns the
 *                 sixteen colours and this file only reads them back
 *
 * The palette and the font are read from the theme's custom properties on the
 * figure, so a capture changes colour with the page and nothing is duplicated
 * here. xterm gets the values as a theme object; asciinema-player reads
 * --term-color-* from its own element, which terminal.css points at the figure,
 * and the player is rebuilt when the mode changes because it reads them once,
 * on mount.
 *
 * The capture is a fixed grid and it is read only: no stdin, no blinking
 * cursor, no scrollback. A terminal in a page is a picture of one, not a shell.
 */
(function () {
  'use strict';

  var LIB = {
    xterm: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/lib/xterm.js',
    xtermCss: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.css',
    unicode11: 'https://cdn.jsdelivr.net/npm/@xterm/addon-unicode11@0.9.0/lib/addon-unicode11.js',
    player: 'https://cdn.jsdelivr.net/npm/asciinema-player@3.17.0/dist/bundle/asciinema-player.min.js',
    playerCss: 'https://cdn.jsdelivr.net/npm/asciinema-player@3.17.0/dist/bundle/asciinema-player.css'
  };

  var ANCHORS = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
    'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
  ];

  var WORDS = {
    noFile: 'The capture did not load.',
    still: ' The file is still here: ',
    noPlayer: 'The recording needs asciinema-player from the CDN and it did not arrive.'
  };

  // ------------------------------------------------------------- loading ---

  var loaded = {};

  function loadScript(src) {
    if (loaded[src]) {
      return loaded[src];
    }
    loaded[src] = new Promise(function (resolve, reject) {
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
    return loaded[src];
  }

  function loadStyle(href) {
    if (loaded[href]) {
      return loaded[href];
    }
    loaded[href] = new Promise(function (resolve) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      // A missing stylesheet is not worth failing a capture over.
      link.onload = function () {
        resolve();
      };
      link.onerror = function () {
        resolve();
      };
      (document.head || document.documentElement).appendChild(link);
    });
    return loaded[href];
  }

  function loadXterm() {
    return loadStyle(LIB.xtermCss)
      .then(function () {
        return loadScript(LIB.xterm);
      })
      .then(function () {
        if (typeof window.Terminal !== 'function') {
          throw new Error(LIB.xterm);
        }
        // The addon is a nicety: a capture with box drawing reads without it.
        return loadScript(LIB.unicode11).then(null, function () {
          return null;
        });
      });
  }

  function loadPlayer() {
    return loadStyle(LIB.playerCss)
      .then(function () {
        return loadScript(LIB.player);
      })
      .then(function () {
        if (!window.AsciinemaPlayer) {
          throw new Error(LIB.player);
        }
        return window.AsciinemaPlayer;
      });
  }

  // --------------------------------------------------------------- words ---

  function text(value) {
    return (value || '').replace(/^\s+|\s+$/g, '');
  }

  function count(value, fallback) {
    var number = parseInt(value, 10);
    return isNaN(number) || number <= 0 ? fallback : number;
  }

  function property(host, name, fallback) {
    var value = window.getComputedStyle(host).getPropertyValue(name);
    value = (value || '').replace(/^\s+|\s+$/g, '');
    return value === '' ? fallback : value;
  }

  function fontSize(host) {
    return count(property(host, '--term-font-size', '13px'), 13);
  }

  function fileName(src) {
    var name = src.split('/').pop();
    return name === '' || name === undefined ? 'terminal' : name;
  }

  // The sixteen colours live in terminal.css. Both libraries are handed the
  // same values, so a capture and a recording of the same program agree.
  function colours(host) {
    var palette = {
      background: property(host, '--term-color-background', '#ffffff'),
      foreground: property(host, '--term-color-foreground', '#161616'),
      selection: property(host, '--term-color-selection', 'rgba(15, 98, 254, 0.18)'),
      values: []
    };
    var i;
    for (i = 0; i < ANCHORS.length; i += 1) {
      palette.values.push(property(host, '--term-color-' + i, palette.foreground));
    }
    return palette;
  }

  function xtermTheme(palette) {
    var theme = {
      background: palette.background,
      foreground: palette.foreground,
      selectionBackground: palette.selection
    };
    var i;
    for (i = 0; i < ANCHORS.length; i += 1) {
      theme[ANCHORS[i]] = palette.values[i];
    }
    // Read only, so the cursor is painted in the ground colour and never seen.
    theme.cursor = palette.background;
    theme.cursorAccent = palette.background;
    return theme;
  }

  function whenFonts(ready) {
    var fonts = window.document.fonts;
    if (fonts && fonts.ready && fonts.status !== 'loaded') {
      fonts.ready.then(ready, ready);
      return;
    }
    ready();
  }

  // ------------------------------------------------------------- escapes ---

  // The fallback: the same screen, without colour. Cursor addressing becomes a
  // line break, which is what makes the stripped capture read as a screen.
  function strip(capture) {
    return capture
      .replace(/\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-9;]*H/g, '\n')
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b[@-Z\\-_]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ ]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  // ---------------------------------------------------------------- frame ---

  function element(tag, className) {
    var node = document.createElement(tag);
    node.className = className;
    return node;
  }

  function link(href) {
    var anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = href;
    return anchor;
  }

  // One cell of the theme's monospace font at the size the theme sets, measured
  // on the page. A recording is fitted to the width only while its text stays at
  // MIN_FONT; below that the frame keeps the page width and scrolls instead.
  var MIN_FONT = 9;

  function cellWidth(host) {
    var probe = element('span', 'terminal-probe');
    probe.style.cssText = 'position: absolute; top: 0; left: 0; visibility: hidden;' +
      'white-space: pre; font-family: ' + property(host, '--font-mono', 'monospace') +
      '; font-size: ' + fontSize(host) + 'px';
    probe.textContent = '0000000000';
    (document.body || document.documentElement).appendChild(probe);
    var width = probe.getBoundingClientRect().width / 10;
    (document.body || document.documentElement).removeChild(probe);
    return width > 0 ? width : 7.8;
  }

  function build(host) {
    var src = text(host.getAttribute('data-src'));
    var title = text(host.getAttribute('data-title')) || (src === '' ? 'terminal' : fileName(src));

    var shell = element('div', 'terminal-window');
    var bar = element('div', 'terminal-bar');
    var heading = element('p', 'terminal-title');
    heading.textContent = title;
    bar.appendChild(heading);

    var body = element('div', 'terminal-body');
    shell.appendChild(bar);
    shell.appendChild(body);
    host.appendChild(shell);
    return { shell: shell, body: body };
  }

  function sorry(body, words, href) {
    body.textContent = '';
    var note = element('p', 'terminal-fallback');
    note.appendChild(document.createTextNode(words + WORDS.still));
    if (href !== '') {
      note.appendChild(link(href));
    }
    body.appendChild(note);
  }

  function plain(body, capture) {
    body.textContent = '';
    var pre = element('pre', 'terminal-pre');
    pre.textContent = strip(capture);
    body.appendChild(pre);
  }

  // ----------------------------------------------------------------- ansi ---

  // A terminal window is as wide as its grid, and never wider than the page: on a
  // phone the frame keeps the width it is given and the grid scrolls inside the
  // body, which is what terminal.css leaves overflow-x for.
  function hug(shell, body, term) {
    if (!term.element) {
      return;
    }
    var width = term.element.getBoundingClientRect().width;
    if (width <= 0) {
      return;
    }
    var box = window.getComputedStyle(body);
    var side = (parseFloat(box.paddingLeft) || 0) + (parseFloat(box.paddingRight) || 0);
    var wanted = Math.ceil(width + side + 2);
    var room = shell.parentNode ? shell.parentNode.clientWidth : 0;
    shell.style.width = (room > 0 && wanted > room ? room : wanted) + 'px';
  }

  function ansi(host, body, shell, src) {
    var cols = count(host.getAttribute('data-cols'), 80);
    var rows = count(host.getAttribute('data-rows'), 24);

    window.fetch(src, { credentials: 'same-origin' }).then(function (reply) {
      if (!reply.ok) {
        throw new Error(src + ' answered HTTP ' + reply.status);
      }
      return reply.text();
    }).then(function (capture) {
      return loadXterm().then(function () {
        whenFonts(function () {
          var term;
          try {
            term = new window.Terminal({
              cols: cols,
              rows: rows,
              disableStdin: true,
              cursorBlink: false,
              cursorStyle: 'bar',
              cursorInactiveStyle: 'none',
              scrollback: 0,
              convertEol: false,
              fontFamily: property(host, '--font-mono', 'monospace'),
              fontSize: fontSize(host),
              lineHeight: 1.25,
              letterSpacing: 0,
              theme: xtermTheme(colours(host))
            });
            term.open(body);
          } catch (err) {
            plain(body, capture);
            return;
          }
          if (window.Unicode11Addon) {
            try {
              term.loadAddon(new window.Unicode11Addon.Unicode11Addon());
              term.unicode.activeVersion = '11';
            } catch (err) {
              // Widths fall back to the built in table; the capture still reads.
            }
          }
          term.write(capture);
          window.requestAnimationFrame(function () {
            hug(shell, body, term);
          });
          document.addEventListener('rshowmodechange', function () {
            term.options.theme = xtermTheme(colours(host));
          });
        });
      }, function () {
        plain(body, capture);
      });
    }, function () {
      sorry(body, WORDS.noFile, src);
    });
  }

  // ----------------------------------------------------------------- cast ---

  // The grid a recording ran on: the figure says so, or the first line of the
  // asciicast does, one JSON object with its width and height.
  function castGrid(host, src, done) {
    var cols = count(host.getAttribute('data-cols'), 0);
    var rows = count(host.getAttribute('data-rows'), 0);
    if (cols > 0 && rows > 0) {
      done(cols, rows);
      return;
    }
    window.fetch(src, { credentials: 'same-origin' }).then(function (reply) {
      return reply.ok ? reply.text() : '';
    }).then(function (cast) {
      var head = {};
      try {
        head = JSON.parse(cast.split('\n')[0]) || {};
      } catch (err) {
        head = {};
      }
      done(count(head.width, 0), count(head.height, 0));
    }, function () {
      done(0, 0);
    });
  }

  function cast(host, body, src) {
    var size = fontSize(host);
    var settings = {
      fit: 'width',
      controls: true,
      autoPlay: false,
      // At rest, the recording shows its opening frames rather than a black
      // rectangle: the prompt and the command being typed.
      poster: 'npt:0:02',
      terminalFontFamily: property(host, '--font-mono', 'monospace'),
      terminalFontSize: size + 'px',
      terminalLineHeight: 1.4
    };

    var player = null;
    var ready = false;

    function start(at) {
      var options = {};
      var key;
      for (key in settings) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          options[key] = settings[key];
        }
      }
      if (at > 0) {
        options.startAt = at;
      }
      body.textContent = '';
      player = window.AsciinemaPlayer.create(src, body, options);
    }

    loadPlayer().then(function () {
      castGrid(host, src, function (cols, rows) {
        if (cols > 0) {
          settings.cols = cols;
        }
        if (rows > 0) {
          settings.rows = rows;
        }
        // Fitting 100 columns into a phone asks for a 5px font. So the recording
        // is fitted only while the fit keeps its text at MIN_FONT; below that
        // fit is off at the theme's size and the body scrolls sideways.
        if (cols > 0 && body.clientWidth > 0 &&
            body.clientWidth / (cols * cellWidth(host)) * size < MIN_FONT) {
          settings.fit = false;
        }
        ready = true;
        start(0);
      });
      // The player reads the palette once, when it mounts, so a mode change
      // means a new player, put back where the old one was.
      document.addEventListener('rshowmodechange', function () {
        var at = 0;
        if (!ready) {
          return;
        }
        try {
          at = player && player.getCurrentTime ? player.getCurrentTime() : 0;
        } catch (err) {
          at = 0;
        }
        try {
          if (player && player.dispose) {
            player.dispose();
          }
        } catch (err) {
          // Nothing to dispose of: the mount below replaces the body anyway.
        }
        start(at || 0);
      });
    }, function () {
      sorry(body, WORDS.noPlayer, src);
    });
  }

  // ---------------------------------------------------------------- mount ---

  function mount(host) {
    var src = text(host.getAttribute('data-src'));
    if (src === '') {
      return;
    }
    var frame = build(host);
    if (host.getAttribute('data-mode') === 'cast') {
      cast(host, frame.body, src);
      return;
    }
    ansi(host, frame.body, frame.shell, src);
  }

  function start() {
    var hosts = document.querySelectorAll('.terminal[data-src]');
    var i;
    for (i = 0; i < hosts.length; i += 1) {
      mount(hosts[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}());
