/*
 * rshow theme "default": results dashboard runtime. Zero dependencies.
 *
 * Markup:
 *
 *   <div class="dashboard" data-src="results.csv" data-facet="workload"
 *        data-x="nodes" data-series="system" data-metric="throughput"
 *        data-unit="publishes/s" data-filters="system,workload,nodes">
 *     <header class="dash-head"><h1>Title</h1>
 *       <p class="dash-lede">One line of prose.</p>
 *       <p class="dash-meta" data-dashboard-source></p></header>
 *     <form class="dash-filters" data-dashboard-filters></form>
 *     <p class="dash-status" data-dashboard-status aria-live="polite"></p>
 *     <section class="dash-section"><h2>Summary</h2>
 *       <div class="dash-box" data-dashboard-summary></div></section>
 *     <section class="dash-section"><h2>Chart</h2>
 *       <figure class="dash-figure"><div data-dashboard-facets></div>
 *         <figcaption data-dashboard-caption></figcaption></figure></section>
 *     <section class="dash-section"><h2>Runs</h2>
 *       <div class="dash-toolbar" data-dashboard-toolbar></div>
 *       <div class="dash-box" data-dashboard-table></div></section>
 *   </div>
 *
 * The data comes from a <script type="application/json" id="data"> block if the
 * page has one, otherwise from data-src, which must be a relative path in this
 * folder: the content policy allows connect-src 'self' and nothing else. A .json
 * path is read as an array of rows or as { "rows": [ ... ] }, anything else as
 * CSV with quoted fields.
 *
 * Which column does what is a page decision, so it is an attribute and not a
 * guess: data-facet groups the panels and the summary, data-x is the axis,
 * data-series splits a panel into several lines (1 to 8, the palette size) and
 * data-metric is the number the summary and the chart read. The controls come
 * from data-filters, one select per text column and a from/to pair per number
 * column.
 *
 * State lives in the URL hash, so a link reproduces a view. The chart is drawn
 * with the token values read at draw time, which is why a mode change redraws it
 * instead of restyling it.
 */
(function () {
  'use strict';

  var root = document.querySelector('.dashboard');
  if (!root) {
    return;
  }

  var hosts = {
    source: root.querySelector('[data-dashboard-source]'),
    status: root.querySelector('[data-dashboard-status]'),
    filters: root.querySelector('[data-dashboard-filters]'),
    summary: root.querySelector('[data-dashboard-summary]'),
    facets: root.querySelector('[data-dashboard-facets]'),
    caption: root.querySelector('[data-dashboard-caption]'),
    toolbar: root.querySelector('[data-dashboard-toolbar]'),
    table: root.querySelector('[data-dashboard-table]')
  };

  function attr(name) {
    return (root.getAttribute(name) || '').replace(/^\s+|\s+$/g, '');
  }

  var config = {
    src: attr('data-src'),
    facet: attr('data-facet'),
    x: attr('data-x'),
    series: attr('data-series'),
    metric: attr('data-metric'),
    unit: attr('data-unit'),
    filters: attr('data-filters')
      .split(',')
      .map(function (name) {
        return name.replace(/^\s+|\s+$/g, '');
      })
      .filter(function (name) {
        return name !== '';
      })
  };

  var state = {
    source: '',
    columns: [],
    rows: [],
    controls: [],
    metric: '',
    sort: { key: '', dir: 1 },
    view: []
  };

  var SEP = '\u0001';
  var lastWidth = 0;
  var toolbarBuilt = false;

  // ------------------------------------------------------------- utilities --

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  }

  function isNumeric(value) {
    if (value === null || value === undefined) {
      return false;
    }
    var text = String(value).replace(/^\s+|\s+$/g, '');
    return text !== '' && isFinite(Number(text));
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  function fmt(value) {
    if (!isFinite(value)) {
      return '-';
    }
    var text = String(round(value));
    var dot = text.indexOf('.');
    var whole = dot === -1 ? text : text.slice(0, dot);
    var rest = dot === -1 ? '' : text.slice(dot);
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
  }

  function fmtTick(value) {
    if (Math.abs(value) >= 10000) {
      return fmt(value / 1000) + 'k';
    }
    return fmt(value);
  }

  function label(key) {
    var words = String(key)
      .replace(/[_.\-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(' ')
      .filter(function (word) {
        return word !== '';
      });
    if (!words.length) {
      return String(key);
    }
    var unit = /^(s|ms|us|ns|kb|mb|gb|pct|%)$/.test(words[words.length - 1]) && words.length > 1;
    var name = unit ? words.slice(0, -1).join(' ') : words.join(' ');
    var text = name.charAt(0).toUpperCase() + name.slice(1);
    return unit ? text + ' (' + words[words.length - 1] + ')' : text;
  }

  function slug(key) {
    return String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function quantile(values, q) {
    if (!values.length) {
      return NaN;
    }
    var sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
    var pos = (sorted.length - 1) * q;
    var low = Math.floor(pos);
    var high = Math.ceil(pos);
    if (low === high) {
      return sorted[low];
    }
    return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
  }

  function niceCeil(value) {
    if (!(value > 0)) {
      return 1;
    }
    var power = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
    var step = value / power;
    var top = step <= 1 ? 1 : step <= 2 ? 2 : step <= 2.5 ? 2.5 : step <= 5 ? 5 : 10;
    return top * power;
  }

  function distinct(rows, key) {
    var seen = [];
    var index = {};
    for (var i = 0; i < rows.length; i += 1) {
      var value = rows[i][key];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      var id = String(value);
      if (index[id] !== true) {
        index[id] = true;
        seen.push(id);
      }
    }
    return seen;
  }

  function findColumn(key) {
    for (var i = 0; i < state.columns.length; i += 1) {
      if (state.columns[i].key === key) {
        return state.columns[i];
      }
    }
    return null;
  }

  function controlFor(key) {
    for (var i = 0; i < state.controls.length; i += 1) {
      if (state.controls[i].key === key) {
        return state.controls[i];
      }
    }
    return null;
  }

  function metricTitle() {
    var column = findColumn(state.metric);
    if (!column) {
      return 'the metric';
    }
    if (config.unit && column.label.toLowerCase().indexOf(config.unit.toLowerCase()) === -1) {
      return column.label + ' (' + config.unit + ')';
    }
    return column.label;
  }

  function facetKey() {
    if (config.facet && findColumn(config.facet)) {
      return config.facet;
    }
    for (var i = 0; i < state.columns.length; i += 1) {
      if (state.columns[i].type === 'text') {
        return state.columns[i].key;
      }
    }
    return '';
  }

  function xKey() {
    if (config.x && findColumn(config.x)) {
      return config.x;
    }
    var group = facetKey();
    for (var i = 0; i < state.columns.length; i += 1) {
      var column = state.columns[i];
      if (column.key !== group && column.key !== state.metric) {
        return column.key;
      }
    }
    return state.columns.length ? state.columns[0].key : '';
  }

  function seriesKey() {
    if (config.series && config.series !== facetKey() && findColumn(config.series)) {
      return config.series;
    }
    return '';
  }

  // ------------------------------------------------------------ csv, json --

  function parseCsv(text) {
    var grid = [];
    var row = [];
    var field = '';
    var quoted = false;
    var i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
          } else {
            quoted = false;
            i += 1;
          }
        } else {
          field += ch;
          i += 1;
        }
        continue;
      }
      if (ch === '"') {
        quoted = true;
        i += 1;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i += 1;
      } else if (ch === '\r') {
        i += 1;
      } else if (ch === '\n') {
        row.push(field);
        grid.push(row);
        row = [];
        field = '';
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      grid.push(row);
    }
    if (!grid.length) {
      return [];
    }

    var head = grid[0].map(function (name) {
      return name.replace(/^\s+|\s+$/g, '');
    });
    var rows = [];
    for (var r = 1; r < grid.length; r += 1) {
      var cells = grid[r];
      var empty = true;
      var record = {};
      for (var c = 0; c < head.length; c += 1) {
        var value = cells[c] === undefined ? '' : String(cells[c]).replace(/^\s+|\s+$/g, '');
        if (value !== '') {
          empty = false;
        }
        record[head[c]] = value;
      }
      if (!empty) {
        rows.push(record);
      }
    }
    return rows;
  }

  function columnsFrom(rows) {
    var keys = [];
    var i;
    var j;
    for (i = 0; i < rows.length; i += 1) {
      var names = Object.keys(rows[i]);
      for (j = 0; j < names.length; j += 1) {
        if (keys.indexOf(names[j]) === -1) {
          keys.push(names[j]);
        }
      }
    }
    return keys;
  }

  function inferType(key, rows) {
    var numeric = true;
    var dates = true;
    var seen = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var value = rows[i][key];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      seen += 1;
      if (numeric && !isNumeric(value)) {
        numeric = false;
      }
      if (dates && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        dates = false;
      }
    }
    if (seen > 0 && numeric) {
      return 'number';
    }
    if (seen > 0 && dates) {
      return 'date';
    }
    return 'text';
  }

  // ---------------------------------------------------------------- state --

  function defaultMetric() {
    var column = findColumn(config.metric);
    if (column && column.type === 'number') {
      return column.key;
    }
    for (var i = 0; i < state.columns.length; i += 1) {
      if (state.columns[i].type === 'number') {
        return state.columns[i].key;
      }
    }
    return '';
  }

  function buildControls() {
    state.controls = [];
    config.filters.forEach(function (key) {
      var column = findColumn(key);
      if (!column) {
        return;
      }
      if (column.type === 'number') {
        var numbers = state.rows
          .map(function (row) {
            return Number(row[key]);
          })
          .filter(function (value) {
            return isFinite(value);
          });
        state.controls.push({
          key: key,
          label: column.label,
          type: 'number',
          from: '',
          to: '',
          min: numbers.length ? Math.min.apply(null, numbers) : 0,
          max: numbers.length ? Math.max.apply(null, numbers) : 0
        });
        return;
      }
      var values = distinct(state.rows, key);
      // A select with a hundred entries is worse than no filter at all.
      if (values.length > 1 && values.length <= 40) {
        state.controls.push({ key: key, label: column.label, type: 'text', value: '', values: values });
      }
    });
  }

  function applyDefaults() {
    state.controls.forEach(function (ctl) {
      if (ctl.type === 'number') {
        ctl.from = '';
        ctl.to = '';
      } else {
        ctl.value = '';
      }
    });
    state.sort = { key: '', dir: 1 };
    state.metric = defaultMetric();
  }

  function readHash() {
    var body = String(window.location.hash || '').replace(/^#/, '');
    if (body === '') {
      return;
    }
    function decode(value) {
      try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
      } catch (err) {
        return value;
      }
    }
    body.split('&').forEach(function (part) {
      if (part === '') {
        return;
      }
      var split = part.indexOf('=');
      if (split === -1) {
        return;
      }
      var key = decode(part.slice(0, split));
      var value = decode(part.slice(split + 1));
      if (key === 'm') {
        var column = findColumn(value);
        if (column && column.type === 'number') {
          state.metric = value;
        }
        return;
      }
      if (key === 's') {
        if (findColumn(value)) {
          state.sort.key = value;
        }
        return;
      }
      if (key === 'd') {
        state.sort.dir = value === 'desc' ? -1 : 1;
        return;
      }
      if (key.indexOf('f.') !== 0) {
        return;
      }
      var ctl = controlFor(key.slice(2));
      if (!ctl) {
        return;
      }
      if (ctl.type === 'number') {
        var bounds = value.split('..');
        ctl.from = bounds[0] ? bounds[0] : '';
        ctl.to = bounds.length > 1 && bounds[1] ? bounds[1] : '';
      } else if (ctl.values.indexOf(value) !== -1) {
        ctl.value = value;
      }
    });
  }

  function writeHash() {
    var parts = [];
    function put(key, value) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
    if (state.metric) {
      put('m', state.metric);
    }
    if (state.sort.key) {
      put('s', state.sort.key);
      put('d', state.sort.dir < 0 ? 'desc' : 'asc');
    }
    state.controls.forEach(function (ctl) {
      if (ctl.type === 'number') {
        if (ctl.from !== '' || ctl.to !== '') {
          put('f.' + ctl.key, ctl.from + '..' + ctl.to);
        }
      } else if (ctl.value !== '') {
        put('f.' + ctl.key, ctl.value);
      }
    });
    var next = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash === next) {
      return;
    }
    var url = window.location.pathname + window.location.search + next;
    try {
      window.history.replaceState(null, '', url);
    } catch (err) {
      window.location.replace(url);
    }
  }

  function filtered() {
    if (!state.controls.length) {
      return state.rows.slice();
    }
    return state.rows.filter(function (row) {
      for (var i = 0; i < state.controls.length; i += 1) {
        var ctl = state.controls[i];
        var value = row[ctl.key];
        if (ctl.type === 'number') {
          if (ctl.from === '' && ctl.to === '') {
            continue;
          }
          if (!isNumeric(value)) {
            return false;
          }
          var number = Number(value);
          if (ctl.from !== '' && isNumeric(ctl.from) && number < Number(ctl.from)) {
            return false;
          }
          if (ctl.to !== '' && isNumeric(ctl.to) && number > Number(ctl.to)) {
            return false;
          }
        } else if (ctl.value !== '' && String(value) !== ctl.value) {
          return false;
        }
      }
      return true;
    });
  }

  function sortedView() {
    var rows = state.view.slice();
    var key = state.sort.key;
    var column = findColumn(key);
    if (!key || !column) {
      return rows;
    }
    var dir = state.sort.dir;
    rows.sort(function (a, b) {
      var left = a[key];
      var right = b[key];
      if (column.type === 'number') {
        var an = Number(left);
        var bn = Number(right);
        if (!isFinite(an) && !isFinite(bn)) {
          return 0;
        }
        if (!isFinite(an)) {
          return 1;
        }
        if (!isFinite(bn)) {
          return -1;
        }
        return (an - bn) * dir;
      }
      return String(left === undefined ? '' : left).localeCompare(String(right === undefined ? '' : right), 'en') * dir;
    });
    return rows;
  }

  function groupOrder() {
    var key = facetKey();
    if (!key) {
      return [];
    }
    var present = distinct(state.view, key);
    return distinct(state.rows, key).filter(function (value) {
      return present.indexOf(value) !== -1;
    });
  }

  // --------------------------------------------------------------- render --

  function renderAll(rebuild) {
    if (rebuild) {
      buildFilters();
    }
    state.view = filtered();
    renderSource();
    renderStatus();
    renderSummary();
    renderCharts();
    renderTable();
    writeHash();
  }

  function renderSource() {
    if (!hosts.source) {
      return;
    }
    var total = state.rows.length;
    hosts.source.innerHTML =
      'Data source: <strong>' +
      esc(state.source) +
      '</strong>. ' +
      fmt(total) +
      (total === 1 ? ' run' : ' runs') +
      ', ' +
      fmt(state.columns.length) +
      ' columns.';
  }

  function renderStatus(message) {
    if (!hosts.status) {
      return;
    }
    hosts.status.textContent =
      message === undefined
        ? 'Showing ' + fmt(state.view.length) + ' of ' + fmt(state.rows.length) + ' runs.'
        : message;
  }

  function renderSummary() {
    var host = hosts.summary;
    if (!host) {
      return;
    }
    var group = facetKey();
    var column = findColumn(state.metric);
    if (!group || !column) {
      host.textContent = '';
      return;
    }
    var groups = groupOrder();
    if (!groups.length) {
      host.textContent = '';
      return;
    }
    var gathered = {};
    state.view.forEach(function (row) {
      if (!isNumeric(row[state.metric])) {
        return;
      }
      var id = String(row[group]);
      if (!gathered[id]) {
        gathered[id] = [];
      }
      gathered[id].push(Number(row[state.metric]));
    });

    var html =
      '<table class="dash-table dash-table--summary"><caption>Runs, median and p95 of ' +
      esc(metricTitle()) +
      ' for each ' +
      esc(findColumn(group).label.toLowerCase()) +
      '.</caption><thead><tr><th scope="col">' +
      esc(findColumn(group).label) +
      '</th><th scope="col" class="dash-num">Runs</th><th scope="col" class="dash-num">Median</th>' +
      '<th scope="col" class="dash-num">p95</th></tr></thead><tbody>';

    groups.forEach(function (value) {
      var values = gathered[value] ? gathered[value] : [];
      html +=
        '<tr><th scope="row">' +
        esc(value) +
        '</th><td class="dash-num">' +
        fmt(values.length) +
        '</td><td class="dash-num">' +
        fmt(quantile(values, 0.5)) +
        '</td><td class="dash-num">' +
        fmt(quantile(values, 0.95)) +
        '</td></tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
  }

  function renderTable() {
    var host = hosts.table;
    if (!host) {
      return;
    }
    var rows = sortedView();

    if (hosts.toolbar && !toolbarBuilt) {
      hosts.toolbar.textContent = '';
      var note = el('p', 'dash-note');
      note.setAttribute('data-dashboard-order', '');
      var button = el('button', 'dash-btn');
      button.type = 'button';
      button.textContent = 'Download CSV of this view';
      button.addEventListener('click', download);
      hosts.toolbar.appendChild(note);
      hosts.toolbar.appendChild(button);
      toolbarBuilt = true;
    }
    var order = hosts.toolbar ? hosts.toolbar.querySelector('[data-dashboard-order]') : null;
    if (order) {
      var sorted = findColumn(state.sort.key);
      order.textContent =
        fmt(rows.length) +
        ' of ' +
        fmt(state.rows.length) +
        ' runs, ' +
        (sorted ? 'sorted by ' + sorted.label.toLowerCase() + (state.sort.dir < 0 ? ', high to low' : ', low to high') : 'in data order') +
        '.';
    }

    if (!rows.length) {
      host.innerHTML = '<p class="dash-empty">No runs match these filters.</p>';
      return;
    }

    var html = '<table class="dash-table dash-table--runs"><thead><tr>';
    state.columns.forEach(function (column) {
      var active = state.sort.key === column.key;
      html +=
        '<th scope="col"' +
        (column.type === 'number' ? ' class="dash-num"' : '') +
        (active ? ' aria-sort="' + (state.sort.dir < 0 ? 'descending' : 'ascending') + '"' : '') +
        '><button type="button" class="dash-sort" data-sort-key="' +
        esc(column.key) +
        '"' +
        (active ? ' data-dir="' + (state.sort.dir < 0 ? 'desc' : 'asc') + '"' : '') +
        '>' +
        esc(column.label) +
        '</button></th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr>';
      state.columns.forEach(function (column) {
        var value = row[column.key];
        if (column.type === 'number') {
          html += '<td class="dash-num">' + esc(isNumeric(value) ? fmt(Number(value)) : String(value === undefined ? '' : value)) + '</td>';
        } else {
          html += '<td>' + esc(value === undefined ? '' : value) + '</td>';
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;

    var buttons = host.querySelectorAll('.dash-sort');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener('click', onSortClick);
    }
  }

  function onSortClick(event) {
    var button = event.currentTarget;
    var key = button.getAttribute('data-sort-key');
    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir < 0 ? 1 : -1;
    } else {
      state.sort.key = key;
      state.sort.dir = 1;
    }
    renderAll(false);
    var again = hosts.table.querySelector('[data-sort-key="' + key.replace(/"/g, '\\"') + '"]');
    if (again) {
      again.focus();
    }
  }

  // --------------------------------------------------------------- filters --

  function setValue(id, value) {
    var node = document.getElementById(id);
    if (node) {
      node.value = value;
    }
  }

  function buildFilters() {
    var host = hosts.filters;
    if (!host) {
      return;
    }
    host.textContent = '';
    if (state.metric) {
      host.appendChild(metricField());
    }
    state.controls.forEach(function (ctl) {
      if (ctl.type === 'number') {
        host.appendChild(numberField(ctl, 'from'));
        host.appendChild(numberField(ctl, 'to'));
      } else {
        host.appendChild(selectField(ctl));
      }
    });
    if (state.metric || state.controls.length) {
      host.appendChild(actionField());
    }
  }

  function metricField() {
    var field = el('div', 'dash-field');
    var node = el('label');
    node.textContent = 'Metric';
    node.setAttribute('for', 'dash-metric');
    var wrap = el('div', 'dash-select');
    var select = document.createElement('select');
    select.id = 'dash-metric';
    state.columns.forEach(function (column) {
      if (column.type !== 'number') {
        return;
      }
      var option = document.createElement('option');
      option.value = column.key;
      option.textContent = column.label;
      if (column.key === state.metric) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      state.metric = select.value;
      renderAll(false);
    });
    wrap.appendChild(select);
    field.appendChild(node);
    field.appendChild(wrap);
    return field;
  }

  function selectField(ctl) {
    var id = 'dash-filter-' + slug(ctl.key);
    var field = el('div', 'dash-field');
    var node = el('label');
    node.textContent = ctl.label;
    node.setAttribute('for', id);
    var wrap = el('div', 'dash-select');
    var select = document.createElement('select');
    select.id = id;
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'All';
    select.appendChild(all);
    ctl.values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      if (value === ctl.value) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      ctl.value = select.value;
      renderAll(false);
    });
    wrap.appendChild(select);
    field.appendChild(node);
    field.appendChild(wrap);
    return field;
  }

  function numberField(ctl, side) {
    var id = 'dash-filter-' + slug(ctl.key) + '-' + side;
    var field = el('div', 'dash-field');
    var node = el('label');
    node.textContent = ctl.label + ' ' + side;
    node.setAttribute('for', id);
    var input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.id = id;
    input.min = String(ctl.min);
    input.max = String(ctl.max);
    input.placeholder = String(side === 'from' ? ctl.min : ctl.max);
    input.value = ctl[side];
    input.addEventListener('input', function () {
      ctl[side] = input.value;
      renderAll(false);
    });
    field.appendChild(node);
    field.appendChild(input);
    return field;
  }

  function actionField() {
    var field = el('div', 'dash-field dash-actions');
    var button = el('button', 'dash-btn dash-btn--ghost');
    button.type = 'button';
    button.textContent = 'Reset filters';
    button.addEventListener('click', function () {
      state.controls.forEach(function (ctl) {
        if (ctl.type === 'number') {
          ctl.from = '';
          ctl.to = '';
          setValue('dash-filter-' + slug(ctl.key) + '-from', '');
          setValue('dash-filter-' + slug(ctl.key) + '-to', '');
        } else {
          ctl.value = '';
          setValue('dash-filter-' + slug(ctl.key), '');
        }
      });
      renderAll(false);
    });
    field.appendChild(button);
    return field;
  }

  // ---------------------------------------------------------------- charts --

  function tokens() {
    var styles = window.getComputedStyle(document.documentElement);
    function read(name, fallback) {
      var value = styles.getPropertyValue(name).replace(/^\s+|\s+$/g, '');
      return value === '' ? fallback : value;
    }
    var charts = [];
    for (var i = 1; i <= 8; i += 1) {
      charts.push(read('--chart-' + i, '#0f62fe'));
    }
    return {
      fg: read('--fg', '#161616'),
      muted: read('--muted', '#525252'),
      grid: read('--border-subtle', '#e0e0e0'),
      axis: read('--border-strong', '#8d8d8d'),
      accent: read('--accent', '#0f62fe'),
      charts: charts
    };
  }

  function renderCharts() {
    var host = hosts.facets;
    if (!host) {
      return;
    }
    var width = Math.round(host.clientWidth || 0);
    if (width < 240) {
      width = Math.max(240, Math.round(root.clientWidth - 32));
    }
    lastWidth = width;
    host.textContent = '';

    var group = facetKey();
    var axis = xKey();
    var column = findColumn(state.metric);
    if (!group || !axis || !column) {
      if (hosts.caption) {
        hosts.caption.textContent = '';
      }
      return;
    }
    var groups = groupOrder();
    if (!state.view.length || !groups.length) {
      host.innerHTML = '<p class="dash-empty">No runs match these filters.</p>';
      if (hosts.caption) {
        hosts.caption.textContent = '';
      }
      return;
    }

    var theme = tokens();
    var split = seriesKey();
    var seriesPresent = split ? distinct(state.view, split) : [];
    var seriesList = split
      ? distinct(state.rows, split)
          .filter(function (value) {
            return seriesPresent.indexOf(value) !== -1;
          })
          // Eight marks is the whole palette; a ninth series would repeat a colour.
          .slice(0, 8)
      : [''];
    var many = seriesList.length > 1;
    var colors = seriesList.map(function (value, index) {
      return many ? theme.charts[index % theme.charts.length] : theme.accent;
    });

    var xColumn = findColumn(axis);
    var xValues = distinct(state.view, axis);
    if (xColumn && (xColumn.type === 'number' || xColumn.type === 'date')) {
      xValues.sort(function (a, b) {
        if (xColumn.type === 'number') {
          return Number(a) - Number(b);
        }
        return a < b ? -1 : a > b ? 1 : 0;
      });
    }
    var bars = !many && xColumn && xColumn.type !== 'number';

    var buckets = {};
    state.view.forEach(function (row) {
      if (!isNumeric(row[state.metric])) {
        return;
      }
      var id = String(row[group]) + SEP + (split ? String(row[split]) : '') + SEP + String(row[axis]);
      if (!buckets[id]) {
        buckets[id] = [];
      }
      buckets[id].push(Number(row[state.metric]));
    });

    var lo = 0;
    var hi = 0;
    Object.keys(buckets).forEach(function (id) {
      buckets[id].forEach(function (value) {
        if (value > hi) {
          hi = value;
        }
        if (value < lo) {
          lo = value;
        }
      });
    });
    if (!(hi > lo)) {
      hi = lo + 1;
    }
    hi = niceCeil(hi);
    if (lo < 0) {
      lo = -niceCeil(-lo);
    }

    var cols = width >= 940 ? 3 : width >= 620 ? 2 : 1;
    if (cols > groups.length) {
      cols = groups.length;
    }
    var gapX = 24;
    var gapY = 26;
    var padL = 44;
    var padR = many ? 64 : 32;
    var padT = 26;
    var padB = 24;
    var panelH = 152;
    var panelW = Math.floor((width - gapX * (cols - 1)) / cols);
    var plotW = Math.max(60, panelW - padL - padR);
    var plotH = panelH - padT - padB;
    var rowsDown = Math.ceil(groups.length / cols);
    var height = rowsDown * panelH + (rowsDown - 1) * gapY;
    var span = hi - lo;

    function xPos(index) {
      if (xValues.length <= 1) {
        return plotW / 2;
      }
      if (xColumn && xColumn.type === 'number') {
        var first = Number(xValues[0]);
        var last = Number(xValues[xValues.length - 1]);
        if (!(last > first)) {
          return plotW / 2;
        }
        return plotW * (0.06 + (0.88 * (Number(xValues[index]) - first)) / (last - first));
      }
      return (plotW * (index + 0.5)) / xValues.length;
    }

    function yPos(value) {
      return plotH - (plotH * (value - lo)) / span;
    }

    var ticks = [lo, lo + span / 2, hi];
    var parts = [];
    var names = groups.map(function (value) {
      return value;
    });
    var summary =
      'Small multiples: ' +
      metricTitle() +
      ' against ' +
      findColumn(axis).label.toLowerCase() +
      ', one panel per ' +
      findColumn(group).label.toLowerCase() +
      ', with the runs listed in the table below.';

    parts.push(
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(summary) + '">'
    );

    groups.forEach(function (value, index) {
      var gx = (index % cols) * (panelW + gapX);
      var gy = Math.floor(index / cols) * (panelH + gapY);
      var ox = gx + padL;
      var oy = gy + padT;
      var labels = [];

      parts.push(
        '<text x="' + ox + '" y="' + (gy + 15) + '" fill="' + theme.fg + '" font-size="13" font-weight="600">' + esc(value) + '</text>'
      );

      ticks.forEach(function (tick) {
        var y = oy + yPos(tick);
        parts.push(
          '<line x1="' + ox + '" y1="' + round(y) + '" x2="' + (ox + plotW) + '" y2="' + round(y) + '" stroke="' + (tick === lo ? theme.axis : theme.grid) + '" stroke-width="1"></line>'
        );
        if (index % cols === 0) {
          parts.push(
            '<text x="' + (ox - 8) + '" y="' + round(y + 4) + '" text-anchor="end" fill="' + theme.muted + '" font-size="11">' + esc(fmtTick(tick)) + '</text>'
          );
        }
      });

      if (Math.floor(index / cols) === rowsDown - 1) {
        xValues.forEach(function (tick, position) {
          parts.push(
            '<text x="' + round(ox + xPos(position)) + '" y="' + (gy + panelH - 10) + '" text-anchor="middle" fill="' + theme.muted + '" font-size="11">' + esc(tick) + '</text>'
          );
        });
      }

      seriesList.forEach(function (series, seriesIndex) {
        var points = [];
        xValues.forEach(function (tick, position) {
          var id = value + SEP + (split ? series : '') + SEP + tick;
          if (!buckets[id]) {
            return;
          }
          var number = quantile(buckets[id], 0.5);
          points.push({ x: xPos(position), y: yPos(number), value: number });
        });
        if (!points.length) {
          return;
        }
        var color = colors[seriesIndex];

        if (bars) {
          var band = plotW / xValues.length;
          var barW = Math.max(6, Math.min(30, band * 0.55));
          points.forEach(function (point) {
            var top = oy + point.y;
            var base = oy + yPos(Math.max(lo, 0));
            parts.push(
              '<rect x="' + round(ox + point.x - barW / 2) + '" y="' + round(top) + '" width="' + round(barW) + '" height="' + round(Math.max(1, base - top)) + '" fill="' + color + '"></rect>'
            );
          });
        } else {
          var path = points
            .map(function (point, position) {
              return (position === 0 ? 'M' : 'L') + round(ox + point.x) + ' ' + round(oy + point.y);
            })
            .join(' ');
          parts.push('<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2"></path>');
          if (points.length <= 24) {
            points.forEach(function (point) {
              parts.push(
                '<circle cx="' + round(ox + point.x) + '" cy="' + round(oy + point.y) + '" r="2.5" fill="' + color + '"></circle>'
              );
            });
          }
        }

        var last = points[points.length - 1];
        if (many && index === 0) {
          labels.push({ x: ox + last.x + 8, y: oy + last.y + 4, text: series });
        } else if (!many) {
          labels.push({ x: ox + last.x + 8, y: oy + last.y + 4, text: fmt(last.value), color: theme.fg });
        }
      });

      labels.sort(function (a, b) {
        return a.y - b.y;
      });
      for (var pass = 1; pass < labels.length; pass += 1) {
        if (labels[pass].y - labels[pass - 1].y < 13) {
          labels[pass].y = labels[pass - 1].y + 13;
        }
      }
      labels.forEach(function (item) {
        parts.push(
          '<text x="' + round(item.x) + '" y="' + round(item.y) + '" fill="' + theme.fg + '" font-size="11">' + esc(item.text) + '</text>'
        );
      });
    });

    parts.push('</svg>');
    host.innerHTML = parts.join('');

    if (hosts.caption) {
      hosts.caption.textContent =
        metricTitle() +
        ' against ' +
        findColumn(axis).label.toLowerCase() +
        ', one panel per ' +
        findColumn(group).label.toLowerCase() +
        (many
          ? ', one line per ' + findColumn(split).label.toLowerCase() + ', labelled at the end of the first panel.'
          : ', with the last value labelled.') +
        ' ' +
        names.length +
        ' panels, one shared vertical scale.';
    }
  }

  // -------------------------------------------------------------- download --

  function csvCell(value) {
    var text = value === undefined || value === null ? '' : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function download() {
    var keys = state.columns.map(function (column) {
      return column.key;
    });
    var rows = sortedView();
    var lines = [keys.map(csvCell).join(',')];
    rows.forEach(function (row) {
      lines.push(
        keys
          .map(function (key) {
            return csvCell(row[key]);
          })
          .join(',')
      );
    });
    var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'dashboard-view.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  // ----------------------------------------------------------------- load --

  function setRows(rows, source) {
    state.rows = rows;
    state.source = source;
    state.columns = columnsFrom(rows).map(function (key) {
      return { key: key, label: label(key), type: inferType(key, rows) };
    });
    buildControls();
    applyDefaults();
    readHash();
    renderAll(true);
  }

  function applyText(text, source) {
    if (/\.json$/i.test(source) || /^\s*[[{]/.test(text)) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        fail('The JSON in ' + source + ' does not parse: ' + err.message);
        return;
      }
      var rows = Array.isArray(data) ? data : data && Array.isArray(data.rows) ? data.rows : null;
      if (!rows) {
        fail('The JSON in ' + source + ' needs an array of rows or an object with a rows array.');
        return;
      }
      setRows(rows, source);
      return;
    }
    var parsed = parseCsv(text);
    if (!parsed.length) {
      fail('No rows found in ' + source + '.');
      return;
    }
    setRows(parsed, source);
  }

  function fail(message) {
    renderStatus(message);
    if (hosts.facets) {
      hosts.facets.innerHTML = '<p class="dash-empty">' + esc(message) + '</p>';
    }
    if (hosts.table) {
      hosts.table.innerHTML = '';
    }
    if (hosts.summary) {
      hosts.summary.innerHTML = '';
    }
    if (hosts.source) {
      hosts.source.textContent = config.src ? 'Data source: ' + config.src : 'No data source.';
    }
  }

  function isRelative(url) {
    return !/^(?:[a-z][a-z0-9+.\-]*:|\/\/|\/)/i.test(url);
  }

  function boot() {
    var inline = document.getElementById('data');
    if (inline && /json/i.test(inline.getAttribute('type') || '')) {
      applyText(inline.textContent, 'the inline data block');
      return;
    }
    if (config.src === '') {
      fail('No data: add data-src to .dashboard or a script with id="data".');
      return;
    }
    if (!isRelative(config.src)) {
      fail('data-src must be a relative path in this folder: ' + config.src);
      return;
    }
    window
      .fetch(config.src, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.text();
      })
      .then(function (text) {
        applyText(text, config.src);
      })
      .catch(function (err) {
        fail('Could not read ' + config.src + ': ' + err.message);
      });
  }

  // ---------------------------------------------------------------- events --

  function redraw() {
    if (state.rows.length) {
      renderCharts();
    }
  }

  document.addEventListener('rshowmodechange', redraw);

  if (hosts.filters) {
    hosts.filters.addEventListener('submit', function (event) {
      event.preventDefault();
    });
  }

  if (window.matchMedia) {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    if (scheme.addEventListener) {
      scheme.addEventListener('change', redraw);
    } else if (scheme.addListener) {
      scheme.addListener(redraw);
    }
  }

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      var width = hosts.facets ? hosts.facets.clientWidth : 0;
      if (Math.abs(width - lastWidth) > 16) {
        redraw();
      }
    }, 160);
  });

  window.addEventListener('hashchange', function () {
    if (!state.rows.length) {
      return;
    }
    applyDefaults();
    readHash();
    renderAll(true);
  });

  boot();
}());
