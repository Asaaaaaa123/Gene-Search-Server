// chips.js — small input widgets of the project editor: chip inputs for gene lists, ordered chip multi-selects for
// signature names, and an icon-only button with an accessible name.
import { h, icon, mount, button } from '../core.js';

const SEPARATORS = /[\s,;]+/;
const QUOTES = /^["'“”‘’]+|["'“”‘’]+$/g;

/** Tokens of typed or pasted text: whitespace, commas and semicolons separate; surrounding quotes are dropped. */
export function parseTokens(text) {
  return String(text ?? '')
    .split(SEPARATORS)
    .map((t) => t.replace(QUOTES, '').trim())
    .filter(Boolean);
}

/** The distinct values of a list as strings, first occurrence kept. */
export function uniqueList(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(String))];
}

/** chipSelect options for the signatures of a configuration, in configuration order: [{value, label, color}]. */
export function signatureOptions(cfg, only) {
  const keep = only ? new Set(only) : null;
  return Object.entries((cfg && cfg.signatures) || {})
    .filter(([name]) => !keep || keep.has(name))
    .map(([name, s]) => ({ value: name, label: (s && s.label) || name.replace(/_/g, ' '), color: s && s.color }));
}

/** "granulocyte (neutrophil)" when the label differs from the key, the label otherwise. */
export function optionLabel(o) {
  const plain = String(o.value).replace(/_/g, ' ');
  return o.label && o.label !== o.value && o.label !== plain ? `${o.label} (${o.value})` : o.label || o.value;
}

/** Icon-only button with an accessible name (button() of core.js only sets a title). */
export function iconButton(iconName, label, onClick, { kind = 'ghost', disabled = false, cls = '' } = {}) {
  const b = button({ icon: iconName, kind, small: true, title: label, disabled, cls, onClick });
  b.setAttribute('aria-label', label);
  return b;
}

/**
 * The gene names of the data, loaded once with `load()` (resolving to {genes: [...], problems: [...]}): gene fields
 * (chipInput's catalog) offer them while typing, take their spelling whatever the case typed, and say which typed genes
 * the data does not have. get() is null until they are loaded (or when they cannot be).
 */
export function geneCatalog(load) {
  let data = null;
  let error = null;
  let pending = null;
  const listeners = new Set();
  const fold = (g) => String(g).toLocaleLowerCase('en-US');
  const cat = {
    get: () => data,
    error: () => error,
    loading: () => !!pending && !data && !error,
    /** The data's spelling of a gene typed in any case; null when the data does not have it. */
    find(g) {
      if (!data) return null;
      return data.exact.has(g) ? g : (data.byFold.get(fold(g)) ?? null);
    },
    /** Up to `limit` genes that start with (first) or contain the text, any case, leaving out `skip` (folded). */
    suggest(text, limit = 12, skip = new Set()) {
      if (!data) return [];
      const q = fold(text.trim());
      if (!q) return [];
      const starts = [];
      const contains = [];
      for (const g of data.genes) {
        const f = fold(g);
        if (skip.has(f)) continue;
        const i = f.indexOf(q);
        if (i === 0) starts.push(g);
        else if (i > 0 && contains.length < limit) contains.push(g);
        if (starts.length >= limit) break;
      }
      return [...starts, ...contains].slice(0, limit);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    load() {
      if (!pending) {
        pending = Promise.resolve().then(load).then((res) => {
          const genes = Array.isArray(res && res.genes) ? res.genes.map(String) : [];
          const byFold = new Map();
          for (const g of genes) if (!byFold.has(fold(g))) byFold.set(fold(g), g);
          data = { genes, exact: new Set(genes), byFold, problems: Array.isArray(res && res.problems) ? res.problems : [] };
          if (!genes.length) { error = (data.problems[0]) || 'the data has no gene names'; data = null; }
        }).catch((e) => { error = e && e.message ? e.message : String(e); })
          .finally(() => listeners.forEach((fn) => fn()));
      }
      return pending;
    },
  };
  return cat;
}

function restartFlash(el) {
  el.classList.remove('flash');
  void el.offsetWidth; // reflow, so that the animation runs again
  el.classList.add('flash');
}

/**
 * Token input for gene names. Enter, Tab, comma, semicolon or space adds the typed text; a pasted list adds every
 * item; duplicates are skipped (the existing chip flashes); Backspace in the empty field removes the last chip;
 * Backspace or Delete on a chip's remove button removes that chip.
 * classify(value) -> '' | 'ok' | 'warn' | 'bad'; isCore(value) -> bold chip; describe(value) -> tooltip.
 * catalog (geneCatalog): typing offers the genes of the data (arrow keys and Enter, or a click, pick one); a gene typed
 * in another case takes the data's spelling; genes the data does not have are listed under the field.
 * Returns {el, set(values), refresh(), values(), focus()}.
 */
export function chipInput({ values = [], onChange, classify, isCore, describe, label = 'Genes', placeholder = 'Add…', id, catalog = null } = {}) {
  let items = uniqueList(values);
  const nodes = new Map();
  const list = h('ul', { class: 'chip-list', 'aria-label': label });
  const entry = h('input', {
    class: 'chip-entry', type: 'text', id, placeholder, spellcheck: false, autocomplete: 'off',
    'aria-label': `Add to ${label}`,
  });
  const box = h('div', { class: 'chip-input' }, list, entry);
  box.addEventListener('mousedown', (e) => {
    if (e.target === box || e.target === list) { e.preventDefault(); entry.focus(); }
  });
  const suggestId = id ? `${id}-suggest` : '';
  const menu = h('ul', { class: 'chip-suggest hidden', role: 'listbox', id: suggestId || null, 'aria-label': `Genes of the data for ${label}` });
  const note = h('div', { class: 'chip-note hidden', role: 'status' });
  const el = catalog ? h('div', { class: 'chip-field' }, h('div', { class: 'chip-anchor' }, box, menu), note) : box;
  if (catalog) {
    entry.setAttribute('role', 'combobox');
    entry.setAttribute('aria-autocomplete', 'list');
    entry.setAttribute('aria-expanded', 'false');
    if (suggestId) entry.setAttribute('aria-controls', suggestId);
  }
  const fold = (g) => String(g).toLocaleLowerCase('en-US');
  let shown = [];
  let active = -1;

  const emit = () => { if (onChange) onChange(items.slice()); };

  function node(v) {
    let li = nodes.get(v);
    if (!li) {
      const remove = h('button', { type: 'button', 'aria-label': `Remove ${v}` }, icon('x', { size: 12 }));
      remove.addEventListener('click', (e) => removeValue(v, e.detail === 0));
      remove.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); removeValue(v, true); }
      });
      li = h('li', { dataset: { value: v } }, h('span', { class: 'chip-text' }, v), remove);
      li.addEventListener('animationend', () => li.classList.remove('flash'));
      nodes.set(v, li);
    }
    const kind = classify ? classify(v) || '' : '';
    li.className = ['chip', kind, isCore && isCore(v) ? 'core' : ''].filter(Boolean).join(' ');
    const tip = describe ? describe(v) : '';
    if (tip) li.title = tip; else li.removeAttribute('title');
    return li;
  }

  function paintNote() {
    if (!catalog) return;
    const known = catalog.get();
    const missing = known ? items.filter((v) => !catalog.find(v)) : [];
    note.classList.toggle('hidden', !missing.length);
    note.replaceChildren(...(missing.length ? [icon('alert', { size: 13 }),
      h('span', null, `Not found in the data: ${missing.join(', ')}. `,
        h('span', { class: 'muted' }, 'Check the spelling: these genes are not scored.'))] : []));
  }

  function paint() {
    for (const v of [...nodes.keys()]) if (!items.includes(v)) nodes.delete(v);
    list.replaceChildren(...items.map(node));
    box.classList.toggle('is-empty', items.length === 0);
    paintNote();
  }

  function closeMenu() {
    shown = [];
    active = -1;
    menu.classList.add('hidden');
    menu.replaceChildren();
    entry.setAttribute('aria-expanded', 'false');
    entry.removeAttribute('aria-activedescendant');
  }

  function paintMenu() {
    if (!catalog) return;
    const text = entry.value;
    if (!text.trim() || SEPARATORS.test(text.trim())) { closeMenu(); return; }
    if (!catalog.get()) {
      if (!catalog.error()) catalog.load();
      menu.replaceChildren(h('li', { class: 'chip-suggest-empty' }, catalog.error() ? `The genes of the data cannot be listed: ${catalog.error()}` : 'Loading the genes of the data…'));
      menu.classList.remove('hidden');
      entry.setAttribute('aria-expanded', 'true');
      return;
    }
    shown = catalog.suggest(text, 12, new Set(items.map(fold)));
    if (active >= shown.length) active = shown.length - 1;
    menu.replaceChildren(...(shown.length ? shown.map((g, i) => {
      const q = text.trim();
      const at = fold(g).indexOf(fold(q));
      const li = h('li', {
        role: 'option', id: suggestId ? `${suggestId}-${i}` : null, class: i === active ? 'active' : '',
        'aria-selected': i === active ? 'true' : 'false',
      }, at >= 0 ? [g.slice(0, at), h('mark', null, g.slice(at, at + q.length)), g.slice(at + q.length)] : g);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(g); });
      return li;
    }) : [h('li', { class: 'chip-suggest-empty' }, catalog.suggest(text, 1).length
      ? `Every gene of the data that contains “${text.trim()}” is already in this list`
      : `No gene of the data contains “${text.trim()}”`)]));
    menu.classList.remove('hidden');
    entry.setAttribute('aria-expanded', 'true');
    if (active >= 0 && suggestId) entry.setAttribute('aria-activedescendant', `${suggestId}-${active}`);
    else entry.removeAttribute('aria-activedescendant');
  }

  function pick(g) {
    entry.value = '';
    closeMenu();
    add([g]);
    entry.focus();
  }

  function removeValue(v, keyboard) {
    const i = items.indexOf(v);
    if (i < 0) return;
    items.splice(i, 1);
    paint();
    emit();
    const next = items[i] ?? items[i - 1];
    const target = keyboard && next !== undefined ? nodes.get(next).querySelector('button') : entry;
    target.focus();
  }

  function add(tokens) {
    let added = false;
    for (const typed of tokens) {
      // the data's spelling of a gene typed in another case (ctsk -> Ctsk)
      const t = (catalog && catalog.find(typed)) || typed;
      const same = items.find((x) => x === t || (catalog && fold(x) === fold(t)));
      if (same !== undefined) {
        const li = nodes.get(same);
        if (li) restartFlash(li);
      } else {
        items.push(t);
        added = true;
      }
    }
    if (added) { paint(); emit(); }
  }

  function commit() {
    const tokens = parseTokens(entry.value);
    entry.value = '';
    if (tokens.length) add(tokens);
  }

  entry.addEventListener('keydown', (e) => {
    if (catalog && !menu.classList.contains('hidden') && shown.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length + 1) % (shown.length + 1);
        if (active === shown.length) active = -1;
        paintMenu();
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) {
        e.preventDefault();
        pick(shown[active]);
        return;
      }
    }
    if (e.key === 'Escape' && catalog && !menu.classList.contains('hidden')) {
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') {
      if (e.key !== 'Enter' || entry.value.trim()) e.preventDefault();
      commit();
    } else if (e.key === 'Tab') {
      if (entry.value.trim()) commit();
    } else if (e.key === 'Backspace' && entry.value === '' && items.length) {
      e.preventDefault();
      items.pop();
      paint();
      emit();
    } else if (e.key === 'Escape' && entry.value) {
      e.stopPropagation();
      entry.value = '';
    }
  });
  entry.addEventListener('paste', (e) => {
    const text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (!SEPARATORS.test(text)) return;
    e.preventDefault();
    const { value } = entry;
    const start = entry.selectionStart ?? value.length;
    const end = entry.selectionEnd ?? value.length;
    entry.value = '';
    add(parseTokens(value.slice(0, start) + text + value.slice(end)));
  });
  entry.addEventListener('blur', () => { closeMenu(); commit(); });
  if (catalog) {
    entry.addEventListener('input', () => { active = -1; paintMenu(); });
    entry.addEventListener('focus', () => { if (!catalog.get() && !catalog.error()) catalog.load(); });
    catalog.onChange(() => {
      if (!el.isConnected) return;
      paint();
      if (document.activeElement === entry) paintMenu();
    });
  }

  paint();
  return {
    el,
    set(next) { items = uniqueList(next); paint(); },
    refresh: paint,
    values: () => items.slice(),
    focus: () => entry.focus(),
  };
}

/**
 * Ordered multi-select of known values shown as chips (with a color swatch), plus a select that adds one more.
 * options: [{value, label, color}]. Selected values missing from the options are kept and shown as bad chips with
 * `unknownText`. Returns {el, set(values)}.
 */
export function chipSelect({ options = [], values = [], onChange, label = 'Selection', placeholder = 'Add…', emptyText = 'None selected', unknownText = 'not available here', id } = {}) {
  let items = uniqueList(values);
  const el = h('div', { class: 'chip-select' });
  const emit = () => { if (onChange) onChange(items.slice()); };

  function paint(focusAdd) {
    const byValue = new Map(options.map((o) => [o.value, o]));
    const chips = items.map((v) => {
      const o = byValue.get(v);
      const text = o ? o.label || v : v;
      return h('li', { class: o ? 'chip' : 'chip bad', title: o ? optionLabel(o) : `${v}: ${unknownText}` },
        o && o.color ? h('span', { class: 'swatch', style: { background: o.color } }) : null,
        h('span', { class: 'chip-text' }, text),
        h('button', {
          type: 'button', 'aria-label': `Remove ${text}`,
          onClick: () => { items = items.filter((x) => x !== v); paint(true); emit(); },
        }, icon('x', { size: 12 })));
    });
    const rest = options.filter((o) => !items.includes(o.value));
    const add = h('select', { class: 'select chip-add', id, 'aria-label': `Add to ${label}`, disabled: rest.length === 0 },
      h('option', { value: '' }, rest.length ? placeholder : 'All selected'),
      rest.map((o) => h('option', { value: o.value }, optionLabel(o))));
    add.addEventListener('change', () => {
      if (!add.value) return;
      items.push(add.value);
      paint(true);
      emit();
    });
    mount(el, h('ul', { class: 'chip-list', 'aria-label': label },
      chips.length ? chips : h('li', { class: 'chip-empty' }, emptyText)), add);
    if (focusAdd) add.focus();
  }

  paint(false);
  return { el, set(next) { items = uniqueList(next); paint(false); } };
}
