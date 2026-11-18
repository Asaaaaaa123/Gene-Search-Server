// signature-editor.js — the Cell Settings tab: the gene signatures and how they are used (positivity calls =
// cfg.primary, tissue assignment = cfg.programs), tissue classes and ubiquitous transcripts. Gene chips are colored
// with the last data-check report. Edits change the draft config in place. The host receptor panel and the adipocyte
// genes of the manuscript are no longer edited here: a run of the application does not use them (any gene list is
// looked at in the Analysis tab of a run); they stay in the configuration for the command line.
import { h, mount, icon, card, button, menuButton, switchToggle, confirmDialog, promptDialog, toast, clone, emptyState } from '../core.js';
import { chipInput, chipSelect, signatureOptions, optionLabel, iconButton, uniqueList } from './chips.js';

const SIG_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const GENE_SET_KEYS = ['signatures', 'classes', 'primary', 'programs', 'receptor_panel', 'adipocyte_genes', 'ubiquitous'];
const NEW_COLORS = ['#1F77B4', '#2CA02C', '#D62728', '#9467BD', '#8C564B', '#E377C2', '#7F7F7F', '#BCBD22', '#17BECF',
  '#FF7F0E', '#AEC7E8', '#98DF8A', '#FF9896', '#C5B0D5'];
const SIG_NAME_HELP = 'Start with a letter; then letters, digits or “_” (at most 64)';
let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isList = Array.isArray;

// ------------------------------------------------------------------------------------------------ pure helpers
function mapList(owner, key, fn) {
  if (owner && isList(owner[key])) owner[key] = fn(owner[key]);
}

function renameKey(o, from, to) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
}

/** Rename signature `from` to `to` and every reference to it. False when `from` is unknown or `to` is taken. */
export function renameSignature(cfg, from, to) {
  if (from === to) return true;
  if (!has(cfg.signatures, from) || has(cfg.signatures, to)) return false;
  const swap = (x) => (x === from ? to : x);
  const swapAll = (list) => list.map(swap);
  cfg.signatures = renameKey(cfg.signatures, from, to);
  for (const s of Object.values(cfg.signatures)) mapList(s, 'competes', swapAll);
  mapList(cfg, 'primary', swapAll);
  mapList(cfg, 'programs', swapAll);
  mapList(cfg.roi, 'exclude', swapAll);
  for (const [sec, keys] of [['compartments', ['signature', 'split_by']], ['uncoupling', ['a', 'b']]]) {
    if (cfg[sec]) for (const k of keys) if (has(cfg[sec], k)) cfg[sec][k] = swap(cfg[sec][k]);
  }
  if (cfg.proximity && isList(cfg.proximity.pairs)) {
    for (const p of cfg.proximity.pairs) { p.from = swap(p.from); p.to = swap(p.to); }
  }
  const sens = cfg.sensitivity;
  if (sens) {
    mapList(sens, 'signatures', swapAll);
    mapList(sens, 'competitors', swapAll);
    if (sens.variants && typeof sens.variants === 'object') {
      for (const [v, sets] of Object.entries(sens.variants)) {
        if (sets && typeof sets === 'object' && has(sets, from)) sens.variants[v] = renameKey(sets, from, to);
      }
    }
  }
  const fig = cfg.figures;
  if (fig) {
    if (isList(fig.positivity_panels)) fig.positivity_panels.forEach((p) => mapList(p, 'signatures', swapAll));
    mapList(fig, 'composition_signatures', swapAll);
    if (fig.lineage_maps) for (const k of ['a', 'b']) if (has(fig.lineage_maps, k)) fig.lineage_maps[k] = swap(fig.lineage_maps[k]);
  }
  return true;
}

/**
 * What deleting `name` changes in what a run of the application does: sentences for the delete dialog. (The settings
 * of the manuscript's own steps that name the signature are left alone: the application does not run those steps.)
 */
export function deletionEffects(cfg, name) {
  const notes = [];
  const only = (list) => isList(list) && list.length > 0 && list.every((x) => x === name);
  if (only(cfg.roi && cfg.roi.exclude)) {
    notes.push('It is the only signature that excludes bins from the region of interest: the whole section (or the drawn region) becomes the region of interest.');
  }
  if (only(cfg.primary)) notes.push('It is the only signature with a positivity call: a run needs at least one.');
  return notes;
}

/** Delete a signature and remove it from every list that names it; proximity pairs that use it are dropped. */
export function deleteSignature(cfg, name) {
  if (!has(cfg.signatures, name)) return;
  delete cfg.signatures[name];
  const drop = (list) => list.filter((x) => x !== name);
  for (const s of Object.values(cfg.signatures)) mapList(s, 'competes', drop);
  mapList(cfg, 'primary', drop);
  mapList(cfg, 'programs', drop);
  mapList(cfg.roi, 'exclude', drop);
  if (cfg.proximity && isList(cfg.proximity.pairs)) {
    cfg.proximity.pairs = cfg.proximity.pairs.filter((p) => p.from !== name && p.to !== name);
  }
  const sens = cfg.sensitivity;
  if (sens) {
    mapList(sens, 'signatures', drop);
    mapList(sens, 'competitors', drop);
    if (sens.variants && typeof sens.variants === 'object') {
      for (const sets of Object.values(sens.variants)) if (sets && typeof sets === 'object') delete sets[name];
    }
  }
  const fig = cfg.figures;
  if (fig) {
    if (isList(fig.positivity_panels)) fig.positivity_panels.forEach((p) => mapList(p, 'signatures', drop));
    mapList(fig, 'composition_signatures', drop);
  }
}

/** Replace the gene sets (signatures, classes, primary, programs, receptor panel, adipocyte genes, ubiquitous). */
export function resetGeneSets(cfg, defaults) {
  for (const k of GENE_SET_KEYS) cfg[k] = clone(defaults[k]);
}

/** Genes known to be present / missing in the data, from a data-check report. known = gene names were readable. */
export function geneCoverage(report) {
  const present = new Set();
  const missing = new Set();
  const genes = report && report.genes;
  if (!genes || genes.n_features === null || genes.n_features === undefined) return { known: false, present, missing };
  for (const v of Object.values(genes.signatures || {})) {
    (v && v.present || []).forEach((g) => present.add(g));
    (v && v.missing || []).forEach((g) => missing.add(g));
  }
  ((genes.ubiquitous || {}).missing || []).forEach((g) => missing.add(g));
  return { known: true, present, missing };
}

const signatureGenes = (s) => uniqueList([...(s.extended || []), ...(s.core || []), ...(s.canonical || [])]);

// ------------------------------------------------------------------------------------------------ editor
/**
 * The Cell Settings tab. ui keeps the selected signature across renders (ui.signature). genes: a geneCatalog of the
 * data (chips.js): the gene fields offer its genes, take their spelling in any case and name the genes it lacks.
 * ubiquitous: false leaves out the ubiquitous transcripts (a run's new cell types do not use them).
 * Returns {el, setReport(report)}.
 */
export function signatureEditor({ cfg, defaults, report, ui, onChange, genes = null, ubiquitous: showUbiquitous = true }) {
  let cov = geneCoverage(report);
  const emit = () => { if (onChange) onChange(); };
  const sigs = () => {
    if (!cfg.signatures || typeof cfg.signatures !== 'object') cfg.signatures = {};
    return cfg.signatures;
  };
  const list = (key) => {
    if (!isList(cfg[key])) cfg[key] = [];
    return cfg[key];
  };
  const selected = () => {
    const names = Object.keys(sigs());
    if (!has(sigs(), ui.signature)) ui.signature = names[0] || null;
    return ui.signature;
  };
  // the genes of the data (genes) when they are loaded, else the last data check
  const inData = (g) => (genes && genes.get() ? (genes.find(g) ? true : false) : cov.present.has(g) ? true : cov.missing.has(g) ? false : null);
  const geneState = (g) => { const x = inData(g); return x === false ? 'bad' : x ? 'ok' : ''; };
  const geneTip = (g) => {
    const x = inData(g);
    if (x === false) return 'Not found in the data of these sections';
    if (x) return genes && genes.get() && genes.find(g) !== g ? `In the data as ${genes.find(g)}` : 'In the data';
    return cov.known ? 'Not checked yet: use Check again in the Data tab' : '';
  };
  const missingOf = (s) => signatureGenes(s).filter((g) => inData(g) === false);

  // editor-level references refreshed by setReport() and by edits elsewhere
  let editorChips = [];
  let paintCoreNote = () => {};
  let flagSwitches = { primary: null, programs: null };

  // ---------------------------------------------------------------- list
  const filter = h('input', { class: 'input sig-filter', type: 'search', placeholder: 'Filter', 'aria-label': 'Filter signatures', autocomplete: 'off' });
  const listEl = h('ul', { class: 'sig-list', 'aria-label': 'Signatures' });
  const countEl = h('span', { class: 'muted small' });
  filter.addEventListener('input', () => paintList());
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...listEl.querySelectorAll('.sig-item')];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = buttons[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) select(next.dataset.name, true);
  });

  function paintList() {
    const all = sigs();
    const names = Object.keys(all);
    const q = filter.value.trim().toLowerCase();
    const shown = names.filter((n) => !q || n.toLowerCase().includes(q) || String(all[n] && all[n].label || '').toLowerCase().includes(q));
    const primary = new Set(list('primary'));
    const programs = new Set(list('programs'));
    const cur = selected();
    countEl.textContent = `${names.length} signature${names.length === 1 ? '' : 's'}`;
    mount(listEl, shown.length ? shown.map((n) => {
      const s = all[n] || {};
      const miss = missingOf(s);
      const plain = n.replace(/_/g, ' ');
      return h('li', null, h('button', {
        type: 'button', class: n === cur ? 'sig-item active' : 'sig-item', 'aria-current': n === cur ? 'true' : null,
        dataset: { name: n }, onClick: () => select(n, true),
      },
      h('span', { class: 'swatch', style: { background: HEX_RE.test(String(s.color)) ? s.color : 'transparent' } }),
      h('span', { class: 'sig-item-text' }, h('span', { class: 'sig-item-label' }, s.label || plain),
        s.label && s.label !== n && s.label !== plain ? h('span', { class: 'sig-item-key' }, n) : null),
      miss.length ? icon('alert', { size: 14, cls: 'sig-warn', title: `Not found in the data: ${miss.join(', ')}` }) : null,
      primary.has(n) ? h('span', { class: 'sig-flag', title: 'Positivity call (primary)' }, 'P') : null,
      programs.has(n) ? h('span', { class: 'sig-flag', title: 'Tissue assignment (programs)' }, 'A') : null,
      h('span', { class: 'sig-count', title: `${(s.extended || []).length} scored genes` }, String((s.extended || []).length))));
    }) : h('li', { class: 'sig-empty' }, names.length ? 'No signature matches the filter.' : 'No signatures yet.'));
  }

  function select(name, focusList) {
    ui.signature = name;
    paintList();
    paintEditor();
    if (focusList) {
      const b = listEl.querySelector('.sig-item.active');
      if (b) b.focus();
    }
  }

  // ---------------------------------------------------------------- editor of the selected signature
  const editorBody = h('div', { class: 'sig-editor' });

  function geneField(s, key, label, help, opts = {}) {
    const id = nextId('sg');
    const count = h('span', { class: 'sig-genes-count' });
    const paintCount = () => { count.textContent = String((s[key] || []).length); };
    const ci = chipInput({
      values: s[key] || [], id, label, catalog: genes,
      placeholder: genes ? 'Type to pick a gene of the data (any case), or paste a list' : 'Type a gene and press Enter, or paste a list',
      classify: opts.classify || geneState, describe: opts.describe || geneTip, isCore: opts.isCore,
      onChange: (v) => { s[key] = v; paintCount(); emit(); if (opts.after) opts.after(); },
    });
    paintCount();
    editorChips.push(ci);
    return { ci, el: h('div', { class: 'field' }, h('label', { for: id }, label, ' ', count), ci.el, help ? h('div', { class: 'help' }, help) : null) };
  }

  function excludedField(s) {
    const box = h('div', { class: 'stack sig-excluded' });
    const rows = Object.entries(s.excluded && typeof s.excluded === 'object' ? s.excluded : {}).map(([gene, reason]) => ({ gene, reason: String(reason ?? '') }));
    let inputs = [];
    const write = () => {
      const out = {};
      for (const r of rows) {
        const g = r.gene.trim();
        if (g && !has(out, g)) out[g] = r.reason;
      }
      s.excluded = out;
      emit();
      const seen = new Set();
      inputs.forEach(({ input, r }) => {
        const g = r.gene.trim();
        const dup = g && seen.has(g);
        seen.add(g);
        input.classList.toggle('invalid', !!dup);
        input.title = dup ? 'Listed twice: only the first entry is kept' : '';
      });
    };
    const paint = (focusLast) => {
      inputs = [];
      mount(box, rows.length ? h('div', { class: 'sig-ex-rows' }, rows.map((r, i) => {
        const input = h('input', { class: 'input mono', value: r.gene, placeholder: 'Gene', 'aria-label': `Excluded gene ${i + 1}`, spellcheck: false, autocomplete: 'off' });
        const reason = h('input', { class: 'input', value: r.reason, placeholder: 'Reason', 'aria-label': `Reason for excluding gene ${i + 1}` });
        input.addEventListener('input', () => { r.gene = input.value; write(); });
        reason.addEventListener('input', () => { r.reason = reason.value; write(); });
        inputs.push({ input, r });
        return h('div', { class: 'sig-ex-row has-row-actions' }, input, reason,
          h('span', { class: 'row-actions' },
            iconButton('trash', `Remove excluded gene ${r.gene || i + 1}`, () => { rows.splice(i, 1); paint(); write(); })));
      })) : h('p', { class: 'muted small' }, 'No excluded genes.'),
      h('div', { class: 'row' }, button({ label: 'Add excluded gene', icon: 'plus', small: true, onClick: () => { rows.push({ gene: '', reason: '' }); paint(true); } })));
      if (focusLast && inputs.length) inputs[inputs.length - 1].input.focus();
    };
    paint();
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Excluded genes'), box,
      h('div', { class: 'help' }, 'Genes deliberately left out of the signature, with the reason (listed in the signature table).'));
  }

  function paintEditor() {
    editorChips = [];
    const name = selected();
    if (!name) {
      flagSwitches = { primary: null, programs: null };
      paintCoreNote = () => {};
      mount(editorBody, emptyState({
        icon: 'dna', title: 'No signatures', text: 'Add a signature, or detect the cell types again (Data tab, Detect again).',
        action: h('div', { class: 'row sig-empty-actions' },
          button({ label: 'Add signature', icon: 'plus', kind: 'primary', onClick: addSignature }),
          button({ label: 'Reset to the default (bone) gene sets', icon: 'undo', onClick: resetToDefaults })),
      }));
      return;
    }
    const s = sigs()[name];
    const keyId = nextId('sk');
    const keyInput = h('input', { class: 'input mono', id: keyId, value: name, spellcheck: false, autocomplete: 'off', dataset: { focus: 'key' } });
    const keyErr = h('div', { class: 'error-text hidden', role: 'alert' });
    const setKeyErr = (msg) => {
      keyErr.textContent = msg;
      keyErr.classList.toggle('hidden', !msg);
      keyInput.classList.toggle('invalid', !!msg);
      keyInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    const commitKey = () => {
      if (!keyInput.isConnected) return;
      const v = keyInput.value.trim();
      if (v === name) { setKeyErr(''); return; }
      const msg = !SIG_RE.test(v) ? SIG_NAME_HELP : has(sigs(), v) ? 'Another signature has this name' : '';
      if (msg) { setKeyErr(msg); return; }
      renameSignature(cfg, name, v);
      ui.signature = v;
      emit();
      paintAll();
      const again = editorBody.querySelector('[data-focus="key"]');
      if (again) again.focus();
      toast(`Renamed “${name}” to “${v}” everywhere it is used`, 'success', { timeout: 2500 });
    };
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitKey(); } else if (e.key === 'Escape') { keyInput.value = name; setKeyErr(''); }
    });
    keyInput.addEventListener('change', commitKey);

    // the destructive action sits in a menu, not as a red button next to the title; the dialog still confirms it
    const actions = menuButton({
      title: 'Signature actions',
      items: [{ label: 'Delete signature', icon: 'trash', danger: true, onClick: () => removeSignature(name) }],
    });
    const head = h('div', { class: 'sig-head' });
    const paintHead = () => {
      actions.setAttribute('aria-label', `Signature actions: ${s.label || name}`);
      mount(head,
        h('span', { class: 'swatch sig-head-swatch', style: { background: HEX_RE.test(String(s.color)) ? s.color : 'transparent' } }),
        h('div', { class: 'sig-head-titles' }, h('h2', null, s.label || name), h('div', { class: 'muted small mono' }, name)),
        actions);
    };
    paintHead();

    const text = (label, key, opts = {}) => {
      const id = nextId('st');
      const input = h('input', { class: 'input', id, value: s[key] ?? '', placeholder: opts.placeholder || '' });
      input.addEventListener('input', () => { s[key] = input.value; emit(); if (opts.after) opts.after(); });
      return h('div', { class: 'field' }, h('label', { for: id }, label), input, opts.help ? h('div', { class: 'help' }, opts.help) : null);
    };
    const colorId = nextId('sc');
    const color = h('input', { type: 'color', class: 'color-input', id: colorId, value: HEX_RE.test(String(s.color)) ? s.color : '#888888' });
    const hexText = h('span', { class: 'mono small muted' }, s.color || '');
    color.addEventListener('input', () => { s.color = color.value; hexText.textContent = color.value; emit(); paintHead(); paintList(); });
    const classId = nextId('scl');
    const classNames = (cfg.classes || []).map((c) => c && c.name).filter(Boolean);
    const classOptions = uniqueList([...classNames, 'removed', ...(s.class ? [s.class] : [])]);
    const classSel = h('select', { class: 'select', id: classId },
      classOptions.map((c) => h('option', { value: c, selected: c === s.class },
        c === 'removed' ? 'removed (assigned, not drawn)' : classNames.includes(c) ? c : `${c} (not drawn)`)));
    classSel.addEventListener('change', () => { s.class = classSel.value; emit(); });

    const toggleIn = (key, on) => {
      const l = list(key);
      const i = l.indexOf(name);
      if (on && i < 0) l.push(name);
      if (!on && i >= 0) l.splice(i, 1);
      emit();
      paintList();
      paintOrder();
    };
    const pSwitch = switchToggle({ checked: list('primary').includes(name), label: 'Positivity call', onChange: (v) => toggleIn('primary', v) });
    const aSwitch = switchToggle({ checked: list('programs').includes(name), label: 'Tissue assignment', onChange: (v) => toggleIn('programs', v) });
    flagSwitches = { primary: pSwitch.querySelector('input'), programs: aSwitch.querySelector('input') };

    let extended;
    let core;
    const afterGenes = () => {
      if (extended) extended.ci.refresh();
      if (core) core.ci.refresh();
      paintCoreNote();
      paintList();
    };
    const canonical = geneField(s, 'canonical', 'Canonical markers', 'Listed in the signature table; not scored unless they are also scored genes.');
    extended = geneField(s, 'extended', 'Scored genes', 'The genes scored for this signature. Core genes are shown in bold.', {
      isCore: (g) => (s.core || []).includes(g), after: afterGenes,
    });
    core = geneField(s, 'core', 'Core genes', 'Lineage-restricted genes: a bin is positive only when at least scoring.min_core of them are detected.', {
      isCore: () => true, after: afterGenes,
      classify: (g) => (geneState(g) === 'bad' ? 'bad' : !(s.extended || []).includes(g) ? 'warn' : geneState(g)),
      describe: (g) => [!(s.extended || []).includes(g) ? 'Not in the scored genes' : '', geneTip(g)].filter(Boolean).join('; '),
    });
    const coreNote = h('div', { class: 'sig-notes' });
    paintCoreNote = () => {
      const notes = [];
      const notScored = (s.core || []).filter((g) => !(s.extended || []).includes(g));
      if (notScored.length) {
        notes.push(h('div', { class: 'state warn' }, icon('alert', { size: 13 }),
          h('span', null, `Core genes that are not scored: ${notScored.join(', ')}. `,
            h('button', {
              type: 'button', class: 'linklike',
              onClick: () => { s.extended = uniqueList([...(s.extended || []), ...notScored]); extended.ci.set(s.extended); emit(); afterGenes(); },
            }, 'Add them to the scored genes'))));
      }
      if ((s.extended || []).length < 2) notes.push(h('div', { class: 'state warn' }, icon('alert', { size: 13 }), 'Fewer than two scored genes: this signature cannot be scored.'));
      const coreGenes = s.core || [];
      if (coreGenes.length && coreGenes.every((g) => inData(g) !== null)) {
        const detected = coreGenes.filter((g) => inData(g)).length;
        const minCore = Number(cfg.scoring && cfg.scoring.min_core);
        const few = Number.isFinite(minCore) && detected < minCore;
        notes.push(h('div', { class: few ? 'state bad' : 'state ok' }, icon(few ? 'alert' : 'check', { size: 13 }),
          `${detected} of ${coreGenes.length} core genes are in the data${few ? `, fewer than scoring.min_core = ${minCore}: no bin can be called positive` : ''}.`));
      }
      mount(coreNote, notes);
    };
    paintCoreNote();

    const competes = chipSelect({
      options: signatureOptions(cfg).filter((o) => o.value !== name), values: s.competes || [], label: 'Competes with',
      placeholder: 'Add a signature…', unknownText: 'not a signature of this project', id: nextId('scp'),
      onChange: (v) => { s.competes = v; emit(); },
    });

    mount(editorBody,
      head,
      h('div', { class: 'form-grid sig-grid' },
        h('div', { class: 'field' }, h('label', { for: keyId }, 'Key name'), keyInput, keyErr,
          h('div', { class: 'help' }, 'Used in the configuration and in column names; renaming updates every reference.')),
        text('Label', 'label', { help: 'Shown on the maps and in the charts.', after: () => { paintHead(); paintList(); } }),
        text('Table label', 'table_label', { help: 'Written to the table of signatures.' }),
        h('div', { class: 'field' }, h('label', { for: classId }, 'Tissue class'), classSel,
          h('div', { class: 'help' }, 'The class of the bins assigned to this signature: a coarser grouping of the cell types.')),
        h('div', { class: 'field' }, h('label', { for: colorId }, 'Color'), h('div', { class: 'row' }, color, hexText))),
      h('div', { class: 'sig-flags' },
        h('div', null, pSwitch, h('div', { class: 'help' }, 'Every bin is called positive or negative for it (listed in primary): a yes/no field of the map and of the Analysis tab.')),
        h('div', null, aSwitch, h('div', { class: 'help' }, 'It competes in the tissue assignment, which gives every bin one cell type (listed in programs).'))),
      extended.el, core.el, coreNote, canonical.el,
      h('div', { class: 'field' }, h('label', { for: competes.el.querySelector('select').id }, 'Competes with'), competes.el,
        h('div', { class: 'help' }, 'A bin that scores higher on one of these signatures is not called positive for this one.')),
      excludedField(s));
  }

  async function removeSignature(name) {
    const s = sigs()[name] || {};
    const effects = deletionEffects(cfg, name);
    const ok = await confirmDialog({
      title: `Delete the signature “${s.label || name}”?`,
      message: h('div', null,
        h('p', null, 'It is also removed from the positivity calls, the tissue assignment, the competitor lists and '
          + 'the region-of-interest exclusions.'),
        effects.length ? h('ul', null, effects.map((t) => h('li', null, t))) : null,
        h('p', { class: 'muted' }, 'Discard (in the bar at the bottom of the page) restores the saved configuration.')),
      confirmLabel: 'Delete signature', danger: true,
    });
    if (!ok) return;
    const names = Object.keys(sigs());
    const i = names.indexOf(name);
    deleteSignature(cfg, name);
    const rest = Object.keys(sigs());
    ui.signature = rest[Math.min(i, rest.length - 1)] || null;
    emit();
    paintAll();
    focusShownLater();         // the menu button that opened the dialog is gone
  }

  /**
   * After a dialog whose answer re-rendered the editor: the focus goes to the signature shown (or to "Add signature")
   * once the dialog has closed and the page is no longer inert. The dialog then gives the focus back to the button
   * that opened it, when that button is still on the page.
   */
  function focusShownLater() {
    setTimeout(() => {
      const target = listEl.querySelector('.sig-item.active') || editorBody.querySelector('.btn');
      if (target && target.isConnected) target.focus();
    }, 0);
  }

  async function addSignature() {
    const name = await promptDialog({
      title: 'New signature', label: 'Key name', placeholder: 'e.g. t_cell', confirmLabel: 'Add signature',
      validate: (v) => (!SIG_RE.test(v) ? SIG_NAME_HELP : has(sigs(), v) ? 'A signature with this name exists' : ''),
    });
    if (!name) return;
    const used = new Set(Object.values(sigs()).map((s) => String(s && s.color).toLowerCase()));
    const plain = name.replace(/_/g, ' ');
    sigs()[name] = {
      label: plain, table_label: plain, color: NEW_COLORS.find((c) => !used.has(c.toLowerCase())) || NEW_COLORS[0],
      class: 'removed', canonical: [], core: [], extended: [], competes: [], excluded: {},
    };
    ui.signature = name;
    filter.value = '';
    emit();
    paintAll();
    const first = editorBody.querySelector('.chip-entry');
    if (first) first.focus();
  }

  // ---------------------------------------------------------------- calling order
  const orderBody = h('div', { class: 'grid-2 sig-order' });

  function paintOrder(focus) {
    const all = sigs();
    const col = (key, title, help) => {
      const l = list(key);
      const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= l.length) return;
        [l[i], l[j]] = [l[j], l[i]];
        emit();
        paintOrder({ key, index: j, dir: d < 0 ? 'up' : 'down' });
        paintList();
      };
      const rows = l.map((n, i) => {
        const s = all[n];
        return h('li', { class: 'order-item' },
          h('span', { class: 'order-n' }, String(i + 1)),
          h('span', { class: 'swatch', style: { background: s && HEX_RE.test(String(s.color)) ? s.color : 'transparent' } }),
          h('span', { class: s ? 'order-label' : 'order-label bad', title: s ? n : 'Unknown signature' }, s ? (s.label || n) : `${n} (unknown)`),
          // shown while the item is hovered or one of them has the focus (.row-actions); Tab still reaches them
          h('span', { class: 'row-actions' },
            iconButton('chevron-up', `Move ${n} up in ${title}`, () => move(i, -1), { disabled: i === 0, cls: 'order-up' }),
            iconButton('chevron-down', `Move ${n} down in ${title}`, () => move(i, 1), { disabled: i === l.length - 1, cls: 'order-down' }),
            iconButton('x', `Remove ${n} from ${title}`, () => {
              l.splice(i, 1);
              emit();
              paintOrder({ key, index: Math.min(i, l.length - 1), dir: 'remove' });
              paintList();
              syncFlags();
            })));
      });
      const rest = Object.keys(all).filter((n) => !l.includes(n));
      const add = h('select', { class: 'select', 'aria-label': `Add a signature to ${title}`, disabled: !rest.length },
        h('option', { value: '' }, rest.length ? 'Add a signature…' : 'Every signature is listed'),
        rest.map((n) => h('option', { value: n }, optionLabel({ value: n, label: all[n] && all[n].label }))));
      add.addEventListener('change', () => {
        if (!add.value) return;
        l.push(add.value);
        emit();
        paintOrder({ key, add: true });
        paintList();
        syncFlags();
      });
      return h('div', { class: 'order-col', dataset: { key } }, h('h3', null, title), h('p', { class: 'muted small' }, help),
        l.length ? h('ol', { class: 'order-list' }, rows) : h('p', { class: 'muted' }, 'Empty.'), add);
    };
    mount(orderBody,
      col('primary', 'Positivity calls', 'Signatures with a positive / negative call per bin (primary), in table and figure order.'),
      col('programs', 'Tissue assignment', 'Signatures competing for each bin in the tissue assignment, which gives every bin its cell type (programs); ties go to the first.'));
    if (!focus) return;
    const column = orderBody.querySelector(`.order-col[data-key="${focus.key}"]`);
    if (!column) return;
    if (focus.add) { column.querySelector('select').focus(); return; }
    const item = column.querySelectorAll('.order-item')[focus.index];
    if (!item) { column.querySelector('select').focus(); return; }
    const want = item.querySelector(focus.dir === 'up' ? '.order-up' : focus.dir === 'down' ? '.order-down' : '.order-up');
    const target = want && !want.disabled ? want : item.querySelector('button:not(:disabled)');
    if (target) target.focus();
  }

  function syncFlags() {
    const name = selected();
    if (flagSwitches.primary) flagSwitches.primary.checked = list('primary').includes(name);
    if (flagSwitches.programs) flagSwitches.programs.checked = list('programs').includes(name);
  }

  // ---------------------------------------------------------------- tissue classes
  const classesBody = h('div', { class: 'stack' });

  function paintClasses(focus) {
    const classes = list('classes');
    const rows = classes.map((c, i) => {
      const nameInput = h('input', { class: 'input cls-name', value: c.name ?? '', 'aria-label': `Class ${i + 1}: name` });
      const commit = () => {
        const v = nameInput.value.trim();
        const old = c.name;
        if (v === old) { nameInput.classList.remove('invalid'); nameInput.title = ''; return; }
        const msg = !v ? 'A class needs a name' : v === 'removed' ? '“removed” is reserved for signatures that are not drawn'
          : classes.some((o, j) => j !== i && o.name === v) ? 'Another class has this name' : '';
        nameInput.classList.toggle('invalid', !!msg);
        nameInput.title = msg;
        if (msg) { toast(msg, 'warning', { timeout: 3000 }); return; }
        c.name = v;
        let n = 0;
        for (const s of Object.values(sigs())) if (s && s.class === old) { s.class = v; n += 1; }
        emit();
        paintEditor();
        if (n) toast(`Class renamed; ${n} signature${n === 1 ? '' : 's'} updated`, 'success', { timeout: 2500 });
      };
      nameInput.addEventListener('change', commit);
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      const colorInput = h('input', { type: 'color', class: 'color-input', value: HEX_RE.test(String(c.color)) ? c.color : '#888888', 'aria-label': `Class ${i + 1}: color` });
      colorInput.addEventListener('input', () => { c.color = colorInput.value; emit(); });
      const emphasis = switchToggle({ checked: !!c.emphasis, label: 'Emphasis', title: 'Drawn with larger markers', onChange: (v) => { c.emphasis = v; emit(); } });
      const move = (d) => {
        const j = i + d;
        [classes[i], classes[j]] = [classes[j], classes[i]];
        emit();
        paintClasses({ index: j, dir: d < 0 ? '.cls-up' : '.cls-down' });
      };
      return h('li', { class: 'cls-row' }, colorInput, nameInput, emphasis,
        h('span', { class: 'row-actions' },
          iconButton('chevron-up', `Move class ${c.name} up`, () => move(-1), { disabled: i === 0, cls: 'cls-up' }),
          iconButton('chevron-down', `Move class ${c.name} down`, () => move(1), { disabled: i === classes.length - 1, cls: 'cls-down' }),
          iconButton('trash', `Remove class ${c.name}`, async () => {
            const users = Object.entries(sigs()).filter(([, s]) => s && s.class === c.name).map(([n, s]) => s.label || n);
            if (users.length && !await confirmDialog({
              title: `Remove the class “${c.name}”?`,
              message: `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} this class. They stay in the tissue assignment and count as class “removed”.`,
              confirmLabel: 'Remove class', danger: true,
            })) return;
            classes.splice(i, 1);
            emit();
            paintClasses({ index: Math.min(i, classes.length - 1), dir: '.cls-up' });
            paintEditor();
          })));
    });
    const add = button({
      label: 'Add class', icon: 'plus', small: true,
      onClick: () => {
        const names = new Set(classes.map((c) => c.name));
        let n = classes.length + 1;
        while (names.has(`class ${n}`)) n += 1;
        classes.push({ name: `class ${n}`, color: '#999999', emphasis: false });
        emit();
        paintClasses({ index: classes.length - 1, dir: '.cls-name' });
        paintEditor();
      },
    });
    mount(classesBody, classes.length ? h('ol', { class: 'cls-list' }, rows) : h('p', { class: 'muted' }, 'No tissue classes: every assigned bin counts as “removed”.'), h('div', { class: 'row' }, add));
    if (focus) {
      const row = classesBody.querySelectorAll('.cls-row')[focus.index];
      const target = row && (row.querySelector(`${focus.dir}:not(:disabled)`) || row.querySelector('.cls-name'));
      if (target) target.focus();
    }
  }

  // ---------------------------------------------------------------- ubiquitous transcripts
  const ubiquitous = chipInput({
    values: isList(cfg.ubiquitous) ? cfg.ubiquitous : [], label: 'Ubiquitous transcripts', catalog: genes,
    placeholder: genes ? 'Type to pick a gene of the data (any case), or paste a list' : 'Type a gene and press Enter, or paste a list',
    classify: geneState, describe: geneTip, onChange: (v) => { cfg.ubiquitous = v; emit(); },
  });

  // Start over from the gene sets of the manuscript (Table 1): in the menu of the Signatures card (and in the empty
  // state), with the confirmation dialog, rather than as a red button of its own.
  async function resetToDefaults() {
    const ok = await confirmDialog({
      title: 'Reset the gene sets?',
      message: 'Signatures, tissue classes, positivity calls, tissue assignment and ubiquitous transcripts return to '
        + 'the default gene sets (mouse bone and marrow). The other settings are kept.',
      confirmLabel: 'Reset gene sets', danger: true,
    });
    if (!ok) return;
    resetGeneSets(cfg, defaults);
    ui.signature = null;
    emit();
    paintAll();
    focusShownLater();         // when it was the button of the empty state, that button is gone
    toast('Gene sets reset to the default (bone) gene sets', 'success');
  }
  const listActions = [
    button({ label: 'Add', icon: 'plus', small: true, onClick: addSignature }),
    menuButton({
      title: 'Gene set actions', small: true,
      items: [{
        label: 'Reset gene sets to the default (bone) gene sets', icon: 'undo', danger: true, onClick: resetToDefaults,
        hint: 'Signatures, tissue classes, calling order and ubiquitous transcripts (mouse bone and marrow)',
      }],
    }),
  ];

  function paintAll() {
    paintList();
    paintEditor();
    paintOrder();
    paintClasses();
    ubiquitous.set(isList(cfg.ubiquitous) ? cfg.ubiquitous : []);
  }

  const geneStatus = h('div', { class: 'gene-status muted small', role: 'status' });
  function paintGeneStatus() {
    if (!genes) { geneStatus.classList.add('hidden'); return; }
    const data = genes.get();
    const err = genes.error();
    mount(geneStatus, data
      ? [icon('check', { size: 13 }), `${data.genes.length.toLocaleString()} genes in the data: type in a gene field to pick from them, in any case. Genes the data does not have are marked red and listed under the field.`,
        data.problems.length ? h('span', { class: 'state warn' }, ` Some sections could not be read: ${data.problems.join('; ')}`) : null]
      : err ? [icon('alert', { size: 13 }), `The genes of the data cannot be listed (${err}): genes are taken as typed.`]
        : [h('span', { class: 'spinner' }), 'Loading the genes of the data…']);
  }
  if (genes) {
    genes.onChange(() => {
      if (!el.isConnected) return;
      paintGeneStatus();
      editorChips.forEach((ci) => ci.refresh());
      paintCoreNote();
      paintList();
    });
    genes.load();
  }

  const el = h('div', { class: 'stack-lg sig-tab' },
    geneStatus,
    h('div', { class: 'sig-layout' },
      card({ title: 'Signatures', subtitle: countEl, actions: listActions, body: h('div', { class: 'stack' }, filter, listEl), cls: 'sig-side', flush: false }),
      h('section', { class: 'card sig-main' }, editorBody)),
    card({ title: 'Calling order', subtitle: 'Order of the positivity calls and of the tissue assignment (P and A in the list).', body: orderBody }),
    h('div', { class: showUbiquitous ? 'grid-2' : '' },
      card({ title: 'Tissue classes', subtitle: 'Coarser groups of the cell types, in legend order. A signature whose class is not listed is assigned but counts as removed.', body: classesBody }),
      showUbiquitous ? card({ title: 'Ubiquitous transcripts', subtitle: 'Transcripts abundant in essentially every cell; a Leiden domain headed by them has no interpretable identity.', body: ubiquitous.el }) : null));

  paintAll();
  paintGeneStatus();

  return {
    el,
    setReport(r) {
      cov = geneCoverage(r);
      editorChips.forEach((ci) => ci.refresh());
      ubiquitous.refresh();
      paintCoreNote();
      paintList();
    },
  };
}
