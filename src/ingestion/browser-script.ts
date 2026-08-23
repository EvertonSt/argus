/**
 * The DOM collector, kept as a plain string.
 *
 * Why a string and not a normal function: transpilers (esbuild via tsx, and
 * ts-node) inject helper references such as `__name` into function bodies when
 * they preserve names. Those helpers do not exist inside the page context, so
 * a transpiled function passed to `page.evaluate` throws
 * `ReferenceError: __name is not defined`. Shipping the collector as source
 * text sidesteps the transpiler entirely and is stable across runners.
 *
 * The shape it returns is `ObservedElement[]` from ./analyze.ts — keep the two
 * in sync.
 */
export const COLLECT_ELEMENTS_SCRIPT = String.raw`(() => {
  var out = [];
  var seen = Object.create(null);

  function isVisible(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function selectorFor(el) {
    var testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId + '"]';
    if (el.id) return '#' + el.id;
    var name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
    return el.tagName.toLowerCase();
  }

  function labelFor(el) {
    var raw = el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              el.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function add(item) {
    var key = item.kind + '::' + item.selector + '::' + item.label;
    if (seen[key]) return;
    seen[key] = true;
    out.push(item);
  }

  Array.prototype.forEach.call(document.querySelectorAll('form'), function (el) {
    if (!isVisible(el)) return;
    var submit = el.querySelector('button, input[type=submit]');
    add({
      kind: 'form',
      label: submit ? labelFor(submit) : (labelFor(el) || 'form'),
      selector: selectorFor(el),
      target: el.getAttribute('action') || undefined
    });
  });

  Array.prototype.forEach.call(
    document.querySelectorAll('button, input[type=submit]'),
    function (el) {
      if (!isVisible(el)) return;
      add({ kind: 'button', label: labelFor(el), selector: selectorFor(el) });
    }
  );

  Array.prototype.forEach.call(
    document.querySelectorAll('input[type=checkbox]'),
    function (el) {
      if (!isVisible(el)) return;
      add({ kind: 'checkbox', label: labelFor(el), selector: selectorFor(el) });
    }
  );

  Array.prototype.forEach.call(
    document.querySelectorAll('input[type=text], input:not([type]), textarea'),
    function (el) {
      if (!isVisible(el)) return;
      add({ kind: 'input', label: labelFor(el), selector: selectorFor(el) });
    }
  );

  Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (el) {
    if (!isVisible(el)) return;
    add({
      kind: 'link',
      label: labelFor(el),
      selector: selectorFor(el),
      target: el.getAttribute('href') || undefined
    });
  });

  Array.prototype.forEach.call(
    document.querySelectorAll('ul, ol, table'),
    function (el) {
      if (!isVisible(el)) return;
      if (el.closest('nav')) return;
      if (el.children.length === 0) return;
      add({
        kind: 'list',
        label: el.getAttribute('data-testid') || el.tagName.toLowerCase(),
        selector: selectorFor(el)
      });
    }
  );

  return out;
})()`;

/**
 * Captures a trimmed DOM snapshot for the triage stage to reason over.
 * Same string-not-function rationale as above.
 */
export const DOM_SNAPSHOT_SCRIPT = String.raw`(() => {
  var main = document.querySelector('main') || document.body;
  return main.innerHTML.replace(/\s+/g, ' ').trim().slice(0, 4000);
})()`;
