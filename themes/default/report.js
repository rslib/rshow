/*
 * rshow theme "default": report runtime. Zero dependencies.
 *
 * Markup: <div class="report"><nav class="toc"></nav><main>...</main></div>
 *
 * This file adds the numbering a paper needs and nothing else. Without it the
 * document is still readable: every section, figure, table and note exists in
 * the HTML, and only the generated labels and the contents list go missing.
 *
 *   h2, h3              numbered 1, 1.1. h2 or h3 with data-nonum is skipped
 *                       (an abstract, a references heading).
 *   <figure>            Figure 1. in the caption, first in the figcaption.
 *   figure.table        Table 1. in the figcaption or the caption.
 *   .equation           (1) at the right end of the line.
 *   a.ref               resolved from #id to "Figure 3" or "Section 2.1".
 *   span.fn             a note: a raised number in the text and a note in the
 *                       right margin, level with the line that holds its
 *                       marker, at the end of the document when narrow or
 *                       printed.
 *   ol.refs + a.cite    a numbered list, [n] in the text and a back-link from
 *                       the entry to every place it is cited.
 *   nav.toc             filled with the numbered headings, collapsible below
 *                       1056px, sticky in the left column above it.
 */
(function () {
  'use strict';

  var report = document.querySelector('.report');
  if (!report) {
    return;
  }
  var main = report.querySelector('main');
  if (!main) {
    return;
  }

  // One map from element id to the words a cross-reference shows.
  var labels = {};
  var toc = [];

  function text(node) {
    return String(node.textContent || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  function slug(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function parentSection(node) {
    var walk = node.parentNode;
    while (walk && walk !== main) {
      if (walk.tagName === 'SECTION') {
        return walk;
      }
      walk = walk.parentNode;
    }
    return null;
  }

  // ------------------------------------------------------------- sections --

  var headings = main.querySelectorAll('h2, h3');
  var i;
  var h2 = 0;
  var h3 = 0;

  for (i = 0; i < headings.length; i += 1) {
    var heading = headings[i];
    var isH2 = heading.tagName === 'H2';
    var label = text(heading);
    var skip = heading.hasAttribute('data-nonum');
    var full = '';
    if (!skip) {
      if (isH2) {
        h2 += 1;
        h3 = 0;
      } else {
        h3 += 1;
      }
      full = isH2 ? String(h2) : h2 + '.' + h3;
    }
    if (!heading.id) {
      heading.id = slug(label) || 'section-' + (full === '' ? i + 1 : full.replace('.', '-'));
    }
    if (!heading.hasAttribute('data-notoc')) {
      toc.push({ level: isH2 ? 2 : 3, text: label, id: heading.id, num: full });
    }
    if (skip) {
      continue;
    }
    var marker = document.createElement('span');
    marker.className = 'sec-num';
    marker.textContent = full;
    // A space after the number, so a copy of the heading reads as a sentence.
    heading.insertBefore(document.createTextNode(' '), heading.firstChild);
    heading.insertBefore(marker, heading.firstChild);
    labels[heading.id] = 'Section ' + full;
    var section = parentSection(heading);
    if (section && section.id) {
      labels[section.id] = 'Section ' + full;
    }
  }

  // -------------------------------------------------- figures and tables --

  var figures = main.querySelectorAll('figure');
  var figN = 0;
  var tabN = 0;

  for (i = 0; i < figures.length; i += 1) {
    var figure = figures[i];
    var isTable = figure.classList.contains('table');
    var n;
    var word;
    if (isTable) {
      tabN += 1;
      n = tabN;
      word = 'Table ';
    } else {
      figN += 1;
      n = figN;
      word = 'Figure ';
    }
    var caption = figure.querySelector('figcaption, caption');
    if (!caption) {
      caption = document.createElement('figcaption');
      figure.appendChild(caption);
    }
    var tag = document.createElement('span');
    tag.className = 'label';
    tag.textContent = word + n + '.';
    caption.insertBefore(document.createTextNode(' '), caption.firstChild);
    caption.insertBefore(tag, caption.firstChild);
    if (figure.id) {
      labels[figure.id] = word + n;
    }
  }

  var equations = main.querySelectorAll('.equation');
  var eqN = 0;

  for (i = 0; i < equations.length; i += 1) {
    eqN += 1;
    var eqNumber = document.createElement('span');
    eqNumber.className = 'eq-num';
    eqNumber.textContent = '(' + eqN + ')';
    equations[i].appendChild(eqNumber);
    if (equations[i].id) {
      labels[equations[i].id] = 'Equation ' + eqN;
    }
  }

  // -------------------------------------------------------------- notes --

  var notes = main.querySelectorAll('span.fn');
  if (notes.length > 0) {
    var aside = document.createElement('aside');
    aside.className = 'notes';
    aside.setAttribute('aria-label', 'Notes');

    var title = document.createElement('h2');
    title.className = 'notes-title';
    title.textContent = 'Notes';
    aside.appendChild(title);

    for (i = 0; i < notes.length; i += 1) {
      var fn = notes[i];
      var number = i + 1;
      var marker = document.createElement('a');
      marker.className = 'fn-ref';
      marker.id = 'fnref-' + number;
      marker.href = '#fn-' + number;
      marker.textContent = number;
      fn.parentNode.insertBefore(marker, fn);

      var note = document.createElement('p');
      note.className = 'note';
      note.id = 'fn-' + number;
      var back = document.createElement('a');
      back.className = 'note-num';
      back.href = '#fnref-' + number;
      back.textContent = number;
      note.appendChild(back);
      while (fn.firstChild) {
        note.appendChild(fn.firstChild);
      }
      fn.parentNode.removeChild(fn);
      aside.appendChild(note);
      labels[note.id] = 'Note ' + number;
    }

    report.appendChild(aside);
  }

  // ----------------------------------------------------------- side notes --
  //
  // On a wide screen a note sits in the note column level with the line that
  // holds its marker, and is pushed down only as far as it must be to clear the
  // note above it. The column is a plain, page-height box and the notes are
  // absolutely placed inside it, so they travel with the text they belong to.
  // Below 1056px and in print the class comes off and every `top` is cleared:
  // the notes are end notes again.

  if (aside) {
    var wide = window.matchMedia ? window.matchMedia('(min-width: 1056px)') : null;
    var noteNodes = aside.querySelectorAll('.note');
    var GAP = 8;

    // The block a marker sits in, so a line can be measured as a fragment of it.
    function blockOf(node) {
      var walk = node;
      while (walk && walk !== main) {
        if (walk.nodeType === 1 && window.getComputedStyle(walk).display !== 'inline') {
          return walk;
        }
        walk = walk.parentNode;
      }
      return null;
    }

    // The top of the line that holds a marker. The marker box is raised, so
    // take the line fragment of its paragraph whose middle is nearest the
    // marker's middle rather than the marker's own box.
    function lineTop(marker) {
      var box = marker.getBoundingClientRect();
      var middle = box.top + box.height / 2;
      var block = blockOf(marker.parentNode);
      var best = box.top;
      if (!block) {
        return best;
      }
      var range = document.createRange();
      range.selectNodeContents(block);
      var rects = range.getClientRects();
      var nearest = Infinity;
      for (var r = 0; r < rects.length; r += 1) {
        var rect = rects[r];
        var distance = Math.abs(rect.top + rect.height / 2 - middle);
        if (distance < nearest) {
          nearest = distance;
          best = rect.top;
        }
      }
      return best;
    }

    function placeNotes() {
      var n;
      if (!wide || !wide.matches) {
        aside.classList.remove('notes--sides');
        for (n = 0; n < noteNodes.length; n += 1) {
          noteNodes[n].style.top = '';
        }
        return;
      }
      aside.classList.add('notes--sides');
      // The column and the text column start at the same line, so a note's
      // offset is the marker's line measured from the top of the column.
      var columnTop = aside.getBoundingClientRect().top + window.pageYOffset;
      // The column heading keeps its place at the top; the first note starts
      // below it and every later note below the one before.
      var head = aside.firstElementChild;
      var floor = head ? head.offsetHeight + GAP : 0;
      for (n = 0; n < noteNodes.length; n += 1) {
        var note = noteNodes[n];
        var marker = document.getElementById('fnref-' + (n + 1));
        var top = floor;
        if (marker) {
          top = lineTop(marker) + window.pageYOffset - columnTop;
        }
        if (top < floor) {
          top = floor;
        }
        note.style.top = Math.round(top) + 'px';
        floor = top + note.offsetHeight + GAP;
      }
    }

    placeNotes();
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(placeNotes);
    }
    window.addEventListener('load', placeNotes);
    if (wide && wide.addEventListener) {
      wide.addEventListener('change', placeNotes);
    }
    var pending = null;
    window.addEventListener('resize', function () {
      if (pending !== null) {
        window.clearTimeout(pending);
      }
      pending = window.setTimeout(function () {
        pending = null;
        placeNotes();
      }, 120);
    });
    document.addEventListener('rshowmodechange', placeNotes);
  }

  // ------------------------------------------------------ cross-references --

  var refs = main.querySelectorAll('a.ref');
  for (i = 0; i < refs.length; i += 1) {
    var href = refs[i].getAttribute('href') || '';
    if (href.charAt(0) !== '#') {
      continue;
    }
    var resolved = labels[href.slice(1)];
    if (resolved !== undefined) {
      refs[i].textContent = resolved;
    }
  }

  // -------------------------------------------------------------- contents --

  var nav = report.querySelector('nav.toc');
  if (nav && toc.length > 0) {
    var box = document.createElement('details');
    box.className = 'toc-box';
    box.open = true;
    var summary = document.createElement('summary');
    summary.textContent = 'Contents';
    box.appendChild(summary);
    var list = document.createElement('ol');
    var currentItem = null;

    for (i = 0; i < toc.length; i += 1) {
      var entry = toc[i];
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = '#' + entry.id;
      if (entry.num !== '') {
        var num = document.createElement('span');
        num.className = 'toc-num';
        num.textContent = entry.num;
        link.appendChild(num);
      }
      var labelSpan = document.createElement('span');
      labelSpan.className = 'toc-text';
      labelSpan.textContent = entry.text;
      link.appendChild(labelSpan);
      item.appendChild(link);
      if (entry.level === 2 || currentItem === null) {
        list.appendChild(item);
        currentItem = item;
      } else {
        var sub = currentItem.querySelector('ol');
        if (!sub) {
          sub = document.createElement('ol');
          currentItem.appendChild(sub);
        }
        sub.appendChild(item);
      }
    }

    box.appendChild(list);
    nav.appendChild(box);
  }

  // ----------------------------------------------------------- references --

  var refList = main.querySelector('ol.refs');
  if (refList) {
    var numbers = {};
    var items = refList.children;
    var back = {};

    for (i = 0; i < items.length; i += 1) {
      var id = items[i].id;
      if (id) {
        numbers[id] = i + 1;
      }
    }

    var cites = main.querySelectorAll('a.cite');
    for (i = 0; i < cites.length; i += 1) {
      var cite = cites[i];
      var target = cite.getAttribute('href') || '';
      if (target.charAt(0) !== '#') {
        continue;
      }
      var key = target.slice(1);
      var index = numbers[key];
      if (index === undefined) {
        continue;
      }
      cite.textContent = '[' + index + ']';
      cite.id = 'cite-' + (i + 1);
      if (!back[key]) {
        back[key] = [];
      }
      back[key].push(i + 1);
    }

    for (key in back) {
      if (!Object.prototype.hasOwnProperty.call(back, key)) {
        continue;
      }
      var entryNode = document.getElementById(key);
      if (!entryNode) {
        continue;
      }
      var where = document.createElement('span');
      where.className = 'cited-at';
      where.appendChild(document.createTextNode('Cited in '));
      for (var k = 0; k < back[key].length; k += 1) {
        if (k > 0) {
          where.appendChild(document.createTextNode(', '));
        }
        var jump = document.createElement('a');
        jump.className = 'backref';
        jump.href = '#cite-' + back[key][k];
        jump.textContent = back[key][k];
        where.appendChild(jump);
      }
      where.appendChild(document.createTextNode('.'));
      entryNode.appendChild(document.createTextNode(' '));
      entryNode.appendChild(where);
    }
  }

  document.documentElement.classList.add('has-report');
}());
