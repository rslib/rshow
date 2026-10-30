import type { Clip, Page } from './cdp.ts';
import type { ComponentSpec, FlowSpec, FocusSpec, AnnotationSpec } from './spec.ts';

export type TokenArg = { name: string; value: string };

export type PageScreen = {
  id: string;
  title: string;
  frame: string;
  kind: string;
  width: number;
  height: number;
  states: string[];
};

export type PageInfo = { kind: string; skin: string; screens: PageScreen[] };

export type CollectedScreen = {
  components: ComponentSpec[];
  flows: FlowSpec[];
  annotations: AnnotationSpec[];
  focus: FocusSpec[];
};

const PAGE_SCRIPT = String.raw`(() => {
  const COMPONENT_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'table', 'form', 'nav',
    'header', 'footer', 'img', 'svg', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'figure',
    'label', 'summary', 'dialog', 'video', 'canvas']);
  const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav',
    'form', 'ul', 'ol', 'li', 'figure', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'fieldset', 'dl',
    'details']);
  const CHROME = /^(mk-|mockup|artboard|note-pin)/;
  const MAX_COMPONENTS = 400;

  const round = (value) => Math.round(value * 100) / 100;
  const flat = (value) => String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();

  const channelOf = (part) => {
    if (part.indexOf('%') >= 0) return Math.round(parseFloat(part) * 2.55);
    return Math.round(parseFloat(part));
  };

  const colorOf = (value) => {
    const text = flat(value).toLowerCase();
    if (text === '' || text === 'transparent' || text === 'none') return null;
    if (text.charAt(0) === '#') {
      const hex = text.slice(1);
      const digits = hex.length === 3 || hex.length === 4 ? hex.split('').map((c) => c + c).join('') : hex;
      if (digits.length !== 6 && digits.length !== 8) return null;
      if (!/^[0-9a-f]+$/.test(digits)) return null;
      return [
        parseInt(digits.slice(0, 2), 16),
        parseInt(digits.slice(2, 4), 16),
        parseInt(digits.slice(4, 6), 16),
        digits.length === 8 ? parseInt(digits.slice(6, 8), 16) : 255,
      ];
    }
    const found = /rgba?\(([^)]*)\)/.exec(text);
    if (found === null) return null;
    const parts = found[1].split(/[\s,\/]+/).filter((part) => part !== '');
    if (parts.length < 3) return null;
    const red = channelOf(parts[0]);
    const green = channelOf(parts[1]);
    const blue = channelOf(parts[2]);
    if (![red, green, blue].every((value) => Number.isFinite(value))) return null;
    let alpha = 255;
    if (parts.length > 3) {
      const raw = parts[3];
      const value = raw.indexOf('%') >= 0 ? parseFloat(raw) / 100 : parseFloat(raw);
      if (Number.isFinite(value)) alpha = Math.round((value <= 1 ? value : value / 255) * 255);
    }
    return [red, green, blue, alpha];
  };

  const sameColor = (left, right) =>
    left !== null && right !== null && left[0] === right[0] && left[1] === right[1] &&
    left[2] === right[2] && left[3] === right[3];

  const pxOf = (value) => {
    const text = flat(value).toLowerCase();
    const scale = text.indexOf('rem') >= 0 || text.indexOf('em') >= 0 ? 16 : 1;
    const size = parseFloat(text);
    return Number.isFinite(size) ? size * scale : null;
  };

  const nameOf = (el) => {
    const tagged = flat(el.getAttribute('data-component'));
    if (tagged !== '') return tagged;
    for (const cls of Array.from(el.classList)) if (cls.indexOf('wf-') === 0) return cls;
    const role = flat(el.getAttribute('role'));
    if (role !== '') return role;
    return el.tagName.toLowerCase();
  };

  const roleOf = (el) => {
    const role = flat(el.getAttribute('role'));
    return role !== '' ? role : el.tagName.toLowerCase();
  };

  const kind = () => {
    if (document.querySelector('.mockup, .artboard')) return 'mockup';
    if (document.querySelector('section.slide')) return 'deck';
    if (document.querySelector('.report')) return 'report';
    return 'page';
  };

  const boards = () => Array.from(document.querySelectorAll('.artboard'));
  const slides = () => Array.from(document.querySelectorAll('section.slide'));

  const headingOf = (el) => {
    const found = el.querySelector('h1, h2, h3');
    return flat(found === null ? el.textContent : found.textContent).slice(0, 80);
  };

  const screens = () => {
    const what = kind();
    if (what === 'mockup') {
      return boards().map((board, index) => {
        const rect = board.getBoundingClientRect();
        const extra = flat(board.getAttribute('data-states'))
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '' && item !== 'default');
        return {
          id: board.id || 'artboard-' + (index + 1),
          title: flat(board.getAttribute('data-title')) || board.id || 'artboard ' + (index + 1),
          frame: flat(board.getAttribute('data-frame')),
          kind: 'artboard',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          states: ['default'].concat(extra),
        };
      });
    }
    if (what === 'deck') {
      return slides().map((slide, index) => {
        const rect = slide.getBoundingClientRect();
        return {
          id: String(index + 1),
          title: headingOf(slide) || 'slide ' + (index + 1),
          frame: '',
          kind: 'slide',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          states: ['default'],
        };
      });
    }
    const root = document.querySelector('main') || document.body;
    const rect = root.getBoundingClientRect();
    return [{
      id: 'page',
      title: flat(document.title) || 'page',
      frame: '',
      kind: what,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      states: ['default'],
    }];
  };

  const elementOf = (id) => {
    const what = kind();
    if (what === 'mockup') {
      const list = boards();
      const found = list.find((board, index) => (board.id || 'artboard-' + (index + 1)) === id);
      return found === undefined ? null : found;
    }
    if (what === 'deck') {
      const list = slides();
      const index = parseInt(id, 10);
      if (!Number.isFinite(index) || index < 1 || index > list.length) return null;
      return list[index - 1];
    }
    return document.querySelector('main') || document.body;
  };

  const applyState = (board, state) => {
    if (window.rshowMockup && typeof window.rshowMockup.focus === 'function') return;
    const wanted = state === undefined || state === '' ? 'default' : state;
    for (const node of Array.from(board.querySelectorAll('[data-state]'))) {
      const name = flat(node.getAttribute('data-state'));
      node.style.display = wanted !== 'default' && name === wanted ? '' : 'none';
    }
  };

  const focus = (id, state) => {
    const mockup = document.querySelector('.mockup');
    if (mockup !== null) mockup.setAttribute('data-view', 'focus');
    const api = window.rshowMockup;
    if (api && typeof api.focus === 'function') {
      try {
        api.focus(id, state);
      } catch (err) {}
    } else if (location.hash !== '#' + id) {
      try {
        location.hash = id;
      } catch (err) {}
    }
    const board = elementOf(id);
    if (board === null) return false;
    const wanted = state === undefined || state === '' ? 'default' : state;
    if (wanted === 'default') board.removeAttribute('data-state');
    else board.setAttribute('data-state', wanted);
    applyState(board, wanted);
    try {
      board.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (err) {}
    return true;
  };

  const records = (node) => {
    if (node.hasAttribute('data-component')) return true;
    if (node.hasAttribute('data-normative')) return true;
    if (flat(node.getAttribute('role')) !== '') return true;
    for (const cls of Array.from(node.classList)) if (cls.indexOf('wf-') === 0) return true;
    const tag = node.tagName.toLowerCase();
    if (COMPONENT_TAGS.has(tag)) return true;
    if (!CONTAINER_TAGS.has(tag)) return false;
    const style = getComputedStyle(node);
    if (style.display.indexOf('flex') >= 0 || style.display.indexOf('grid') >= 0) return true;
    return style.padding !== '0px';
  };

  const isChrome = (node) => Array.from(node.classList).some((cls) => CHROME.test(cls));

  const matchTokens = (item, tokens) => {
    const found = {};
    const color = colorOf(item.color);
    if (color !== null) {
      for (const token of tokens) {
        if (sameColor(colorOf(token.value), color)) {
          found.color = token.name;
          break;
        }
      }
    }
    const background = colorOf(item.background);
    if (background !== null && background[3] > 0) {
      for (const token of tokens) {
        if (sameColor(colorOf(token.value), background)) {
          found.background = token.name;
          break;
        }
      }
    }
    const size = pxOf(item.fontSize);
    if (size !== null) {
      for (const token of tokens) {
        if (pxOf(token.value) === size && /(px|rem|em)$/.test(token.value)) {
          found.fontSize = token.name;
          break;
        }
      }
    }
    const radius = pxOf(item.radius);
    if (radius !== null) {
      for (const token of tokens) {
        if (pxOf(token.value) === radius && /(px|rem|em)$/.test(token.value)) {
          found.radius = token.name;
          break;
        }
      }
    }
    for (const token of tokens) {
      if (token.value === item.fontWeight) {
        found.fontWeight = token.name;
        break;
      }
    }
    return Object.keys(found).length === 0 ? null : found;
  };

  const describe = (el, origin, tokens) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const normative = el.hasAttribute('data-normative') && !el.hasAttribute('data-placeholder');
    const item = {
      name: nameOf(el),
      role: roleOf(el),
      x: round(rect.left - origin.left),
      y: round(rect.top - origin.top),
      w: round(rect.width),
      h: round(rect.height),
      color: style.color,
      background: style.backgroundColor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      radius: style.borderTopLeftRadius,
      normative: normative,
    };
    if (normative) item.text = flat(el.textContent).slice(0, 200);
    if (CONTAINER_TAGS.has(el.tagName.toLowerCase())) {
      const rows = style.rowGap;
      const columns = style.columnGap;
      const gap = rows !== 'normal' && rows !== '0px' ? rows : columns !== 'normal' && columns !== '0px' ? columns : '';
      if (gap !== '') item.gap = gap;
      if (style.padding !== '0px') item.padding = style.padding;
    }
    const matched = matchTokens(item, tokens);
    if (matched !== null) item.tokens = matched;
    return item;
  };

  const components = (id, tokens) => {
    const el = elementOf(id);
    if (el === null) return [];
    const origin = el.getBoundingClientRect();
    const out = [];
    for (const node of Array.from(el.querySelectorAll('*'))) {
      if (out.length >= MAX_COMPONENTS) break;
      if (isChrome(node)) continue;
      if (node.closest('.note-pin') !== null) continue;
      if (!records(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;
      out.push(describe(node, origin, tokens));
    }
    return out;
  };

  const info = (id) => {
    const el = elementOf(id);
    if (el === null) return null;
    const origin = el.getBoundingClientRect();
    const flows = [];
    const seen = new Set();
    for (const node of Array.from(el.querySelectorAll('a[href], [data-goto]'))) {
      const goto = flat(node.getAttribute('data-goto'));
      const href = flat(node.getAttribute('href'));
      const target = goto !== '' ? goto : href;
      if (target === '') continue;
      const to = target.charAt(0) === '#' ? target.slice(1) : target;
      if (to === '' || seen.has(to)) continue;
      seen.add(to);
      flows.push({ from: id, to: to });
    }
    const annotations = Array.from(el.querySelectorAll('.note-pin[data-note]')).map((pin) => {
      const rect = pin.getBoundingClientRect();
      return {
        text: flat(pin.getAttribute('data-note')),
        x: round(rect.left - origin.left),
        y: round(rect.top - origin.top),
      };
    });
    const focus = [];
    for (const node of Array.from(el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'))) {
      if (node.disabled === true || node.hidden === true) continue;
      const tabindex = node.getAttribute('tabindex');
      if (tabindex !== null && Number(tabindex) < 0) continue;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      focus.push({ name: nameOf(node), role: roleOf(node), text: flat(node.textContent).slice(0, 80) });
    }
    return { flows: flows, annotations: annotations, focus: focus };
  };

  const clip = (id) => {
    const el = elementOf(id);
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: Math.max(0, Math.round(rect.left + window.scrollX)),
      y: Math.max(0, Math.round(rect.top + window.scrollY)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };

  const mode = (value) => {
    const root = document.documentElement;
    if (window.rshowMode && typeof window.rshowMode.set === 'function') {
      try {
        window.rshowMode.set(value);
        return root.getAttribute('data-mode');
      } catch (err) {}
    }
    if (value === '' || value === 'system') root.removeAttribute('data-mode');
    else root.setAttribute('data-mode', value);
    return root.getAttribute('data-mode');
  };

  globalThis.__rshow = {
    kind: kind,
    skin: () => {
      const mockup = document.querySelector('.mockup');
      return mockup === null ? '' : flat(mockup.getAttribute('data-skin'));
    },
    screens: screens,
    focus: focus,
    components: components,
    info: info,
    clip: clip,
    mode: mode,
  };
  return true;
})()`;

function call(name: string, args: readonly unknown[]): string {
  return `__rshow.${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;
}

export async function openHelpers(page: Page, url: string): Promise<PageInfo> {
  await page.navigate(url);
  return reattach(page);
}

export async function reattach(page: Page): Promise<PageInfo> {
  await page.evaluate(PAGE_SCRIPT);
  return pageInfo(page);
}

export async function pageInfo(page: Page): Promise<PageInfo> {
  return page.evaluate<PageInfo>('({ kind: __rshow.kind(), skin: __rshow.skin(), screens: __rshow.screens() })');
}

export async function setMode(page: Page, mode: string): Promise<void> {
  await page.evaluate(call('mode', [mode]));
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: mode === 'dark' ? 'dark' : 'light' }],
  });
}

export async function focusScreen(page: Page, screen: string, state: string): Promise<boolean> {
  const found = await page.evaluate<boolean>(call('focus', [screen, state]));
  await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  return found === true;
}

export async function collectComponents(page: Page, screen: string, tokens: TokenArg[]): Promise<ComponentSpec[]> {
  return page.evaluate<ComponentSpec[]>(call('components', [screen, tokens]));
}

export async function collectInfo(page: Page, screen: string): Promise<CollectedScreen | null> {
  return page.evaluate<CollectedScreen | null>(call('info', [screen]));
}

export async function screenClip(page: Page, screen: string): Promise<Clip | null> {
  return page.evaluate<Clip | null>(call('clip', [screen]));
}
