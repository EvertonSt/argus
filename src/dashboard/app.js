/**
 * Argus dashboard — vanilla JS, no build step.
 *
 * Reads the same JSON files the CLI writes. Nothing here is generated at build
 * time, so a reviewer can run the pipeline and just refresh the page.
 */
(function () {
  'use strict';

  // The dashboard lives at /src/dashboard/, data at /data/ — hop up two levels.
  var DATA = '../../data/';

  function get(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error(url + ' -> ' + response.status);
      return response.json();
    });
  }

  /** Missing files are normal before the first run; treat them as empty. */
  function getOptional(url, fallback) {
    return get(url).catch(function () {
      return fallback;
    });
  }

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shortTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso || '');
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  var CHART_DEFAULTS = {
    color: '#8891a5',
    grid: '#242a38',
  };

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function renderMeta(latest) {
    if (!latest) return;
    var gate = latest.gateFailed
      ? '<strong style="color:#ff6b6b">FAIL</strong>'
      : '<strong style="color:#3ddc97">PASS</strong>';
    el('run-meta').innerHTML =
      'Run <strong>' + escapeHtml(latest.runId) + '</strong> · ' +
      escapeHtml(shortTime(latest.timestamp)) + '<br>' +
      'mode <strong>' + escapeHtml(latest.mode) + '</strong> · CI gate ' + gate;
    el('footer-mode').innerHTML =
      'latest run in <strong>' + escapeHtml(latest.mode) + '</strong> mode';
  }

  function card(label, value, cls, sub) {
    return (
      '<div class="card"><div class="label">' + escapeHtml(label) + '</div>' +
      '<div class="value ' + (cls || '') + '">' + value + '</div>' +
      (sub ? '<div class="sub">' + escapeHtml(sub) + '</div>' : '') +
      '</div>'
    );
  }

  function renderCards(latest, bugs) {
    if (!latest) return;
    var summary = latest.summary || {};
    var triage = latest.triage || [];
    var realBugs = triage.filter(function (t) { return t.verdict === 'real_bug'; }).length;
    var openBugs = bugs.filter(function (b) { return !b.isDuplicateOf; }).length;
    var passRate = summary.total ? Math.round((summary.passed / summary.total) * 100) : 0;
    var coverage = (latest.testCases || []).length;
    var features = ((latest.inventory || {}).features || []).length;

    el('summary-cards').innerHTML =
      card('Pass rate', passRate + '%', passRate === 100 ? 'ok' : 'warn',
        summary.passed + ' of ' + summary.total + ' tests') +
      card('Failures', String(summary.failed || 0), summary.failed ? 'danger' : 'ok',
        'in the latest run') +
      card('Real bugs', String(realBugs), realBugs ? 'danger' : 'ok',
        'confirmed by triage') +
      card('Open bugs', String(openBugs), openBugs ? 'warn' : 'ok',
        'excluding duplicates') +
      card('Coverage', String(coverage), 'accent',
        coverage + ' cases over ' + features + ' features') +
      card('AI calls', String(latest.aiCalls || 0), 'accent',
        latest.mode === 'mock' ? 'mock mode — no spend' : 'this run');
  }

  function renderTrend(index) {
    var ctx = el('trend-chart');
    if (!ctx || !index.length) return;

    new Chart(ctx, {
      type: 'line',
      data: {
        labels: index.map(function (run) { return shortTime(run.timestamp); }),
        datasets: [
          {
            label: 'Passed',
            data: index.map(function (r) { return r.passed; }),
            borderColor: '#3ddc97',
            backgroundColor: 'rgba(61,220,151,.14)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
          {
            label: 'Failed',
            data: index.map(function (r) { return r.failed; }),
            borderColor: '#ff6b6b',
            backgroundColor: 'rgba(255,107,107,.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: CHART_DEFAULTS.color, boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: CHART_DEFAULTS.color }, grid: { color: CHART_DEFAULTS.grid } },
          y: {
            beginAtZero: true,
            ticks: { color: CHART_DEFAULTS.color, precision: 0 },
            grid: { color: CHART_DEFAULTS.grid },
          },
        },
      },
    });
  }

  function renderTriageChart(triage) {
    var ctx = el('triage-chart');
    if (!ctx) return;

    var counts = { real_bug: 0, flaky: 0, selector_drift: 0, environment_issue: 0 };
    triage.forEach(function (result) {
      if (counts[result.verdict] !== undefined) counts[result.verdict] += 1;
    });

    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Real bug', 'Flaky', 'Selector drift', 'Environment'],
        datasets: [
          {
            data: [counts.real_bug, counts.flaky, counts.selector_drift, counts.environment_issue],
            backgroundColor: ['#ff6b6b', '#ffc857', '#7c8cff', '#8891a5'],
            borderColor: '#141822',
            borderWidth: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.color, boxWidth: 12, padding: 14 } },
        },
      },
    });
  }

  function renderBugs(bugs) {
    var body = document.querySelector('#bugs-table tbody');
    if (!bugs.length) {
      el('bugs-empty').classList.remove('hidden');
      document.querySelector('#bugs-table').classList.add('hidden');
      return;
    }

    body.innerHTML = bugs
      .slice()
      .reverse()
      .map(function (bug) {
        var status = bug.isDuplicateOf
          ? '<span class="pill pill-dup">duplicate of ' + escapeHtml(bug.isDuplicateOf) + '</span>'
          : '<span class="pill pill-new">new</span>';
        return (
          '<tr>' +
          '<td><span class="badge badge-' + escapeHtml(bug.severity) + '">' + escapeHtml(bug.severity) + '</span></td>' +
          '<td>' + escapeHtml(bug.title) + '</td>' +
          '<td><code>' + escapeHtml(bug.testCaseId) + '</code></td>' +
          '<td>' + escapeHtml(shortTime(bug.filedAt)) + '</td>' +
          '<td>' + status + '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function renderSelfHeals(triage) {
    var pending = triage.filter(function (result) {
      return result.verdict === 'selector_drift' && result.suggestedFix;
    });

    if (!pending.length) {
      el('selfheal-empty').classList.remove('hidden');
      return;
    }

    el('selfheal-list').innerHTML = pending
      .map(function (result) {
        return (
          '<div class="heal-entry">' +
          '<div class="triage-head">' +
          '<code>' + escapeHtml(result.testCaseId) + '</code>' +
          '<span class="confidence">' + Math.round(result.confidence * 100) + '% confidence</span>' +
          '</div>' +
          '<p class="reasoning">' + escapeHtml(result.reasoning) + '</p>' +
          '<div class="fix">' + escapeHtml(result.suggestedFix) + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderTriageLog(entries) {
    if (!entries.length) {
      el('triage-log').innerHTML = '<p class="empty-row">Nothing failed in the latest run.</p>';
      return;
    }

    el('triage-log').innerHTML = entries
      .map(function (entry) {
        var fix = entry.suggestedFix
          ? '<div class="fix">' + escapeHtml(entry.suggestedFix) + '</div>'
          : '';
        return (
          '<div class="triage-entry">' +
          '<div class="triage-head">' +
          '<span class="verdict verdict-' + escapeHtml(entry.verdict) + '">' + escapeHtml(entry.verdict) + '</span>' +
          '<span class="triage-title">' + escapeHtml(entry.testTitle) + '</span>' +
          '<span class="confidence">' + Math.round(entry.confidence * 100) + '% confidence</span>' +
          '</div>' +
          '<p class="reasoning">' + escapeHtml(entry.reasoning) + '</p>' +
          '<p class="error-line">' + escapeHtml(String(entry.errorMessage || '').split('\n')[0]) + '</p>' +
          fix +
          '</div>'
        );
      })
      .join('');
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  function boot() {
    // file:// blocks fetching sibling JSON in every modern browser, so say so
    // plainly rather than rendering an empty dashboard that looks broken.
    if (window.location.protocol === 'file:') {
      el('file-protocol-note').classList.remove('hidden');
      return;
    }

    Promise.all([
      getOptional(DATA + 'runs/index.json', []),
      getOptional(DATA + 'bugs.json', []),
      getOptional(DATA + 'triage-log.json', []),
    ])
      .then(function (results) {
        var index = results[0] || [];
        var bugs = results[1] || [];
        var triageLog = results[2] || [];

        if (!index.length) {
          el('empty-state').classList.remove('hidden');
          return;
        }

        var latestEntry = index[index.length - 1];
        return get(DATA + 'runs/' + latestEntry.runId + '/run.json').then(function (latest) {
          el('content').classList.remove('hidden');
          renderMeta(latest);
          renderCards(latest, bugs);
          renderTrend(index);
          renderTriageChart(latest.triage || []);
          renderBugs(bugs);
          renderSelfHeals(latest.triage || []);
          renderTriageLog(triageLog);
        });
      })
      .catch(function (error) {
        el('empty-state').classList.remove('hidden');
        el('empty-state').querySelector('h2').textContent = 'Could not load run data';
        el('empty-state').querySelector('p').textContent = String(error.message || error);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
