/*
 * rshow theme "default" math runtime. Zero dependencies.
 *
 * Markup: <span class="math">\tau_{l,k}</span> is inline math and
 * <div class="math">T = \sum_l ...</div> is display math, because the element
 * name decides the mode. The text of the element is the LaTeX. A $ in the prose
 * is a price and is never scanned for math.
 *
 * KaTeX itself is vendored ahead of this file by
 * packages/cli/scripts/vendor-katex.mjs, which appends these lines after
 * katex.min.js and the copy handler.
 *
 * A node that already holds a .katex child is left alone, so a second run of
 * the script and a clone in the presenter window are both safe. A node inside
 * aside.notes is skipped: the notes window does not load math.css, and a note
 * is what the speaker says rather than a line of the slide.
 */
(function () {
  'use strict';

  function render() {
    var nodes = document.querySelectorAll('.math');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.querySelector('.katex') !== null) continue;
      if (node.closest('aside.notes') !== null) continue;
      try {
        window.katex.render(node.textContent || '', node, {
          displayMode: node.tagName === 'DIV',
          throwOnError: false,
          strict: 'ignore',
          trust: false
        });
      } catch (err) {
        // throwOnError covers bad LaTeX, so this leaves the source text in
        // place rather than breaking the rest of the page.
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
