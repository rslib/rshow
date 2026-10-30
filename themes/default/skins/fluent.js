/*
 * rshow theme "default": the fluent skin, the real components.
 *
 * skins/fluent.css draws the whole kit with Fluent-like tokens, so the skin
 * reads as Windows 11 with no network at all. This file goes one step further
 * while the fluent skin is active: it upgrades the six controls that a design
 * review actually argues about into the real Microsoft Fluent UI Web Components
 * v3, so a wf-button is a fluent-button, a wf-input is a fluent-field around a
 * fluent-text-input, and so on. The component and the drawn kit agree because
 * they read the same token values out of fluent.css.
 *
 * Pinned version. @fluentui/web-components 3.1.3, the newest 3.x on npm when
 * this file was written, fetched as one bundled ES module from jsdelivr:
 *
 *   https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.3/dist/web-components.min.js
 *
 * It is a single self contained module: no import map, no bundler, no bare
 * specifier. The module registers its custom elements in a task after it
 * evaluates, so this file waits on customElements.whenDefined before it builds
 * anything.
 *
 * Fallback. A mockup is a drawing and must be readable on a plane: if the
 * module does not load, or a browser without custom elements reaches this file,
 * nothing is upgraded and fluent.css alone draws every control. A half upgraded
 * screen is worse than a plain one, so a failure reverts what this file built.
 *
 * Switching skins away from fluent puts every original wf-* element back where
 * it was, so wire, sketch and custom see the kit they expect.
 *
 * Markup stays the kit's markup. data-goto, href, data-state and inline styles
 * move onto the upgraded element, which is why a hotspot or a state still works
 * after the upgrade.
 */
(function () {
  'use strict';

  var main = document.querySelector('.mockup');
  if (!main) {
    return;
  }

  var MODULE_URL = 'https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.3/dist/web-components.min.js';
  var WAIT_LIMIT = 8000;

  var SELECTOR = ['.wf-button', '.wf-input', '.wf-select', '.wf-checkbox', '.wf-toggle', '.wf-tabs'].join(', ');
  var SKIP_CLASS = ['primary', 'ghost', 'on', 'is-active', 'wf-button', 'wf-input', 'wf-select', 'wf-checkbox', 'wf-toggle', 'wf-tabs'];

  var phase = 'idle';
  var waiting = [];
  var built = [];
  var loadTimer = null;
  var debounce = null;
  var tabSeq = 0;

  // The skin of a screen is the nearest data-skin above it, so a page that pins
  // one skin per screen and carries its own elsewhere still upgrades the right
  // screens, and only those.
  function skinOf(node) {
    var host = node.closest ? node.closest('[data-skin]') : null;
    return host ? host.getAttribute('data-skin') : '';
  }

  function fluentScreens() {
    var screens = main.querySelectorAll('.mk-screen');
    var active = [];
    for (var i = 0; i < screens.length; i += 1) {
      if (skinOf(screens[i]) === 'fluent') {
        active.push(screens[i]);
      }
    }
    return active;
  }

  function isFluent() {
    return fluentScreens().length > 0;
  }

  function warn(message) {
    if (window.console && window.console.warn) {
      window.console.warn('[rshow fluent skin] ' + message);
    }
  }

  // ---------------------------------------------------------------- load --

  function settle(ok) {
    phase = ok ? 'ready' : 'failed';
    main.setAttribute('data-fluent-upgrade', ok ? 'components' : 'css-only');
    var callbacks = waiting;
    waiting = [];
    for (var i = 0; i < callbacks.length; i += 1) {
      callbacks[i](ok);
    }
  }

  function ensure(done) {
    if (phase === 'ready' || phase === 'failed') {
      done(phase === 'ready');
      return;
    }
    waiting.push(done);
    if (phase === 'loading') {
      return;
    }
    phase = 'loading';
    if (typeof window.customElements === 'undefined' || typeof window.customElements.whenDefined !== 'function') {
      warn('custom elements are not supported: fluent.css draws the controls');
      settle(false);
      return;
    }
    window.clearTimeout(loadTimer);
    loadTimer = window.setTimeout(function () {
      if (phase === 'loading') {
        warn('the Fluent module did not answer in time: fluent.css draws the controls');
        settle(false);
      }
    }, WAIT_LIMIT);
    // A dynamic import of a URL is the browser's own module loader: no build
    // step, no import map, and the pinned version is in the URL.
    import(MODULE_URL)
      .then(function () {
        return window.customElements.whenDefined('fluent-button');
      })
      .then(function () {
        window.clearTimeout(loadTimer);
        if (phase !== 'loading') {
          return;
        }
        var all = ['fluent-button', 'fluent-text-input', 'fluent-listbox', 'fluent-dropdown', 'fluent-checkbox', 'fluent-switch', 'fluent-tablist'];
        for (var i = 0; i < all.length; i += 1) {
          if (!window.customElements.get(all[i])) {
            warn('the Fluent module did not define ' + all[i] + ': fluent.css draws the controls');
            settle(false);
            return;
          }
        }
        settle(true);
      })
      .catch(function (err) {
        window.clearTimeout(loadTimer);
        warn('the Fluent module could not be loaded (' + (err && err.message ? err.message : err) + '): fluent.css draws the controls');
        settle(false);
      });
  }

  // -------------------------------------------------------------- shapes --

  function copy(node, target) {
    var attrs = node.attributes;
    var i;
    for (i = 0; i < attrs.length; i += 1) {
      var name = attrs[i].name;
      if (name === 'class' || name.indexOf('data-') === 0) {
        continue;
      }
      if (name === 'aria-selected' || name === 'checked') {
        continue;
      }
      target.setAttribute(name, attrs[i].value);
    }
    for (i = 0; i < attrs.length; i += 1) {
      if (attrs[i].name.indexOf('data-') === 0) {
        target.setAttribute(attrs[i].name, attrs[i].value);
      }
    }
    var classes = (node.className || '').split(/\s+/);
    for (i = 0; i < classes.length; i += 1) {
      var name2 = classes[i];
      if (name2 !== '' && SKIP_CLASS.indexOf(name2) < 0) {
        target.classList.add(name2);
      }
    }
    if (node.getAttribute('style')) {
      target.setAttribute('style', node.getAttribute('style'));
    }
    return target;
  }

  function text(node) {
    return String(node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // The kit labels a field in the notch on its border, so an upgraded control is
  // wrapped in the kit's field: the label is ours, the control is Fluent's.
  function labelled(node, control) {
    var field = document.createElement('span');
    field.className = 'wf-field';
    var label = node.getAttribute('data-label');
    if (label) {
      var caption = document.createElement('span');
      caption.className = 'wf-label';
      caption.textContent = label;
      field.appendChild(caption);
    }
    field.appendChild(control);
    copy(node, field);
    return field;
  }

  function upgradeButton(node) {
    var primary = node.classList.contains('primary');
    var ghost = node.classList.contains('ghost');
    var link = node.tagName === 'A' && node.getAttribute('href');
    var el = document.createElement(link ? 'fluent-anchor-button' : 'fluent-button');
    el.setAttribute('appearance', primary ? 'primary' : ghost ? 'subtle' : 'secondary');
    if (link) {
      el.setAttribute('href', node.getAttribute('href'));
    }
    if (node.hasAttribute('disabled')) {
      el.setAttribute('disabled', '');
    }
    var label = text(node);
    if (label !== '') {
      el.textContent = label;
    }
    copy(node, el);
    return el;
  }

  // A text field is a fluent-text-input; the label is the kit's, kept because
  // the library's own label needs a fluent-field wrapper and a slot per part,
  // and the drawing wants the label in the notch on the border like the rest of
  // the kit.
  function upgradeInput(node) {
    var input = document.createElement('fluent-text-input');
    var value = text(node);
    if (value !== '') {
      input.setAttribute('value', value);
    }
    var placeholder = node.getAttribute('data-placeholder');
    if (placeholder) {
      input.setAttribute('placeholder', placeholder);
    }
    if (node.getAttribute('aria-label')) {
      input.setAttribute('aria-label', node.getAttribute('aria-label'));
    } else if (node.getAttribute('data-label')) {
      input.setAttribute('aria-label', node.getAttribute('data-label'));
    }
    return labelled(node, input);
  }

  function optionsOf(node) {
    var found = [];
    var children = node.querySelectorAll('.wf-option');
    var i;
    for (i = 0; i < children.length; i += 1) {
      found.push(text(children[i]));
    }
    if (found.length === 0 && node.getAttribute('data-options')) {
      found = node.getAttribute('data-options').split('|');
      for (i = 0; i < found.length; i += 1) {
        found[i] = found[i].trim();
      }
    }
    if (found.length === 0) {
      var only = text(node);
      found.push(only === '' ? 'Select' : only);
    }
    return found;
  }

  // The dropdown reads its options out of a slotted fluent-listbox, so the
  // options are built into one: without it the control has nothing to show.
  function upgradeSelect(node) {
    var dropdown = document.createElement('fluent-dropdown');
    var listbox = document.createElement('fluent-listbox');
    var values = optionsOf(node);
    var current = node.getAttribute('data-value') || values[0];
    for (var i = 0; i < values.length; i += 1) {
      var option = document.createElement('fluent-option');
      option.textContent = values[i];
      if (values[i] === current) {
        option.setAttribute('selected', '');
      }
      listbox.appendChild(option);
    }
    dropdown.appendChild(listbox);
    return labelled(node, dropdown);
  }

  function upgradeCheckbox(node) {
    var box = document.createElement('fluent-checkbox');
    if (node.getAttribute('data-checked') === 'true') {
      box.setAttribute('checked', '');
    }
    if (node.getAttribute('data-label')) {
      box.textContent = node.getAttribute('data-label');
    }
    copy(node, box);
    return box;
  }

  function upgradeToggle(node) {
    var control = document.createElement('fluent-switch');
    if (node.classList.contains('on') || node.getAttribute('data-checked') === 'true') {
      control.setAttribute('checked', '');
    }
    if (node.getAttribute('data-label')) {
      control.textContent = node.getAttribute('data-label');
    }
    copy(node, control);
    return control;
  }

  function upgradeTabs(node) {
    var list = document.createElement('fluent-tablist');
    var active = '';
    var children = node.children;
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      var tab = document.createElement('fluent-tab');
      tabSeq += 1;
      tab.setAttribute('id', 'mk-fluent-tab-' + tabSeq);
      tab.textContent = text(child);
      copyTabs(child, tab);
      if (child.classList.contains('is-active') || child.getAttribute('aria-selected') === 'true') {
        active = tab.getAttribute('id');
      }
      list.appendChild(tab);
    }
    if (list.children.length > 0) {
      list.setAttribute('activeid', active !== '' ? active : list.children[0].getAttribute('id'));
    }
    copy(node, list);
    return list;
  }

  function copyTabs(child, tab) {
    var attrs = child.attributes;
    for (var i = 0; i < attrs.length; i += 1) {
      if (attrs[i].name.indexOf('data-') === 0) {
        tab.setAttribute(attrs[i].name, attrs[i].value);
      }
    }
  }

  var BUILDERS = {
    'wf-button': upgradeButton,
    'wf-input': upgradeInput,
    'wf-select': upgradeSelect,
    'wf-checkbox': upgradeCheckbox,
    'wf-toggle': upgradeToggle,
    'wf-tabs': upgradeTabs
  };

  // ------------------------------------------------------------- upgrade --

  function build(node) {
    var keys = Object.keys(BUILDERS);
    for (var i = 0; i < keys.length; i += 1) {
      if (!node.classList.contains(keys[i])) {
        continue;
      }
      var replacement;
      try {
        replacement = BUILDERS[keys[i]](node);
      } catch (err) {
        warn('could not upgrade ' + keys[i] + ': ' + (err && err.message ? err.message : err));
        return;
      }
      var parent = node.parentNode;
      if (!parent) {
        return;
      }
      parent.replaceChild(replacement, node);
      built.push({ original: node, upgraded: replacement });
      return;
    }
  }

  function upgrade() {
    var screens = fluentScreens();
    forget(screens);
    if (screens.length === 0) {
      return;
    }
    ensure(function (ok) {
      if (!ok) {
        restore();
        return;
      }
      for (var s = 0; s < screens.length; s += 1) {
        if (skinOf(screens[s]) !== 'fluent') {
          continue;
        }
        var nodes = screens[s].querySelectorAll(SELECTOR);
        for (var i = 0; i < nodes.length; i += 1) {
          build(nodes[i]);
        }
      }
    });
  }

  // A screen that stopped being fluent goes back to the kit's own controls,
  // while the screens that are still fluent keep their real components.
  function forget(screens) {
    var stale = [];
    for (var i = 0; i < built.length; i += 1) {
      var host = built[i].upgraded.closest ? built[i].upgraded.closest('.mk-screen') : null;
      if (screens.indexOf(host) < 0) {
        stale.push(host);
      }
    }
    for (var s = 0; s < stale.length; s += 1) {
      restore(stale[s]);
    }
  }

  function restore(screen) {
    for (var i = built.length - 1; i >= 0; i -= 1) {
      var record = built[i];
      if (screen !== undefined) {
        var host = record.upgraded.closest ? record.upgraded.closest('.mk-screen') : null;
        if (host !== screen) {
          continue;
        }
      }
      var parent = record.upgraded.parentNode;
      if (parent) {
        parent.replaceChild(record.original, record.upgraded);
      }
      built.splice(i, 1);
    }
  }

  // --------------------------------------------------------------- wiring --

  function schedule(delay) {
    if (debounce !== null) {
      window.clearTimeout(debounce);
    }
    debounce = window.setTimeout(function () {
      debounce = null;
      upgrade();
    }, delay === undefined ? 40 : delay);
  }

  document.addEventListener('mkchange', function () {
    schedule(60);
  });

  // The components paint from the tokens of the active mode, so a mode change
  // is a repaint and nothing more: the same upgrade pass keeps both modes and
  // the toolbar's skin switch in one code path.
  document.addEventListener('rshowmodechange', function () {
    if (isFluent()) {
      schedule(20);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      schedule(0);
    });
  } else {
    schedule(0);
  }
}());
