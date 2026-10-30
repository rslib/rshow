# Dashboard

## Contents

- What it is for
- Skeleton
- Where the data comes from
- Which column does what
- The four blocks
- State in the link
- Checks

A results dashboard is the page a reader works in rather than reads: a filter bar, a summary, small multiples and the table of rows behind them.
It is a fixed template, so the four blocks are set and the data is the work.
`dashboard.css` sets the look and `dashboard.js` reads the data, draws the chart and keeps the view in the link.

## What it is for

Use it when somebody asks the same question of the same table every week, such as what the last run did or which configuration was slowest.
Use a report when the answer is a sentence.
Use a deck when the answer is a room.
A dashboard that nobody filters is a report with extra steps.

## Skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Write-ahead log, results per run</title>
<link rel="stylesheet" href="/_themes/default@3/fonts.css">
<link rel="stylesheet" href="/_themes/default@3/tokens.css">
<link rel="stylesheet" href="/_themes/default@3/dashboard.css">
<script src="/_themes/default@3/mode.js"></script>
<script defer src="/_themes/default@3/dashboard.js"></script>
</head>
<body>
<div class="dashboard" data-src="results.csv" data-facet="workload"
     data-x="nodes" data-series="system" data-metric="throughput"
     data-unit="publishes/s" data-filters="system,workload,nodes">

  <header class="dash-head">
    <h1>Write-ahead log, results per run</h1>
    <p class="dash-lede">One line that says what this page answers.</p>
    <p class="dash-meta" data-dashboard-source></p>
  </header>

  <form class="dash-filters" data-dashboard-filters></form>
  <p class="dash-status" data-dashboard-status aria-live="polite"></p>

  <section class="dash-section">
    <h2>Summary</h2>
    <div class="dash-box" data-dashboard-summary></div>
  </section>

  <section class="dash-section">
    <h2>Throughput by node count</h2>
    <figure class="dash-figure">
      <div data-dashboard-facets></div>
      <figcaption data-dashboard-caption></figcaption>
    </figure>
  </section>

  <section class="dash-section">
    <h2>Runs</h2>
    <div class="dash-toolbar" data-dashboard-toolbar></div>
    <div class="dash-box" data-dashboard-table></div>
  </section>

</div>
</body>
</html>
```

## Where the data comes from

The data is a file in the folder, such as `results.csv`, named by `data-src`.
A `.json` path reads as an array of rows or as `{"rows": [...]}`, and anything else reads as CSV with quoted fields.
A `<script type="application/json" id="data">` block wins over `data-src`, which is how a small table travels inside the one file.

The content policy allows `connect-src 'self'` and nothing else, so a page never fetches from a third party.
Publish the CSV with the page and say in the footer where the rows came from, such as the commit and the date of the run.
Keep the CSV plain, with a header row, one row per run and one column per fact.

## Which column does what

Which column does what is a page decision, so it is an attribute and never a guess.

| Attribute | Meaning |
|---|---|
| `data-facet` | the column that groups the panels and the summary |
| `data-x` | the column on the axis |
| `data-series` | the column that splits a panel into lines, one to eight |
| `data-metric` | the number the summary and the chart read |
| `data-unit` | the unit printed after a value, such as `publishes/s` |
| `data-filters` | the columns that get a control, one select per text column and a from and to pair per number column |

## The four blocks

- The summary is runs, median and p95 of the metric, and it names the filter it was computed under.
- The small multiples are one panel per facet value, on a shared scale, so a reader compares shapes and not axes.
- The table holds the rows behind the chart, sorted by a click on a header, with numbers right aligned in tabular figures.
- The status line says how many rows of how many are showing, and it is the only place a count of hidden rows appears.

A chart is labelled at the end of the line and the palette is `--chart-1` to `--chart-8`, so no legend box is needed.
The script reads those tokens at draw time, which is why a mode change redraws the chart instead of restyling it.

## State in the link

The filters and the sort live in the URL hash, so a link reproduces the view.
Send the person the link with the filters set, because a screenshot of a filtered view is a claim nobody can check.
The reset control returns to the whole table, and the address without a hash is the whole table.

## Checks

- `rshow check <dir>` exits 0, and it holds no unpinned script and no absolute request.
- `rshow preview <dir>`, then filter, sort and reload: the view comes back from the link.
- Look at it at desktop width and at 360px, in both modes.
  Check that the table scrolls inside its own box.
- Every number on the page is in the CSV, and the footer says where the CSV came from.
