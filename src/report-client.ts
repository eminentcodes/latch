import type { CaseResult, RunResult, Verdict } from './types.js';

// This function is serialized from compiled JavaScript into the static report.
// Keep helpers inside it so the report remains self-contained and needs no CDN.
export function reportClient(): void {
  function element<T extends HTMLElement = HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Report element missing: ${id}`);
    return found as T;
  }
  const payload = JSON.parse(element('report-data').textContent ?? '') as {run: RunResult; before: RunResult | null; comparison: 'seeded' | 'repair'};
  let active = payload.run;
  let selected: string | null = null;
  const setText = (id: string, value: string | number) => {element(id).textContent = String(value);};
  const engineName = (run: RunResult) => run.engine === 'kane' ? 'Kane CLI' : 'Playwright · local development';
  function safePath(path: unknown): path is string {
    return typeof path === 'string' && path.trim() === path && !/[\x00-\x20\x7f]/.test(path)
      && !/^[a-z]+:/i.test(path) && !path.startsWith('//') && !path.includes('\\') && !path.split('/').includes('..');
  }
  function safeWebLink(value: string): boolean {
    try {const url = new URL(value); return value.trim() === value && url.protocol === 'https:' && !url.username && !url.password;} catch {return false;}
  }
  function setBadge(target: HTMLElement, status: Verdict): void {
    target.className = 'badge ' + status;
    target.textContent = status;
  }
  function choose(item: CaseResult): void {
    selected = item.check.id;
    document.querySelectorAll<HTMLButtonElement>('.case-button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.case === selected)));
    setText('case-id', item.check.id);
    setBadge(element('case-badge'), item.verdict);
    setText('case-reason', item.reason);
    setText('actor', item.actorLabel);
    setText('action', item.check.action + ' · ' + item.resourceLabel);
    setText('expected', item.check.expect === 'allow' ? 'Allow this action' : 'Deny this action');
    setText('observed', item.observation ? 'HTTP ' + item.observation.status + ' · ' + item.driver.state : 'Verification incomplete');
    const control = active.cases.find(candidate => candidate.check.id === item.controlId);
    setText('control', item.check.expect === 'allow' ? 'This case is a permitted-user control' : control ? control.check.id + ' · ' + control.verdict : 'Missing control');
    setText('mutation', item.observation ? (item.observation.beforeHash === item.observation.afterHash ? 'Unchanged' : 'Changed') : 'Not observed');
    setText('duration', (item.driver.durationMs / 1000).toFixed(1) + 's');
    const preview = element('preview');
    preview.replaceChildren();
    const screenshot = item.driver.evidence.find(evidence => evidence.kind === 'screenshot' && safePath(evidence.path));
    const video = item.driver.evidence.find(evidence => evidence.kind === 'video' && safePath(evidence.path));
    if (screenshot) {
      const image = document.createElement('img');
      image.src = screenshot.path;
      image.alt = 'Browser screenshot for ' + item.check.id;
      preview.appendChild(image);
    } else if (video) {
      const player = document.createElement('video');
      player.src = video.path;
      player.controls = true;
      player.preload = 'metadata';
      preview.appendChild(player);
    } else {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = item.driver.evidence.some(evidence => evidence.kind === 'kane-pack')
        ? 'Download the Kane evidence pack below to inspect screenshots, requests, and failure details.'
        : 'No complete browser evidence is available for this case.';
      preview.appendChild(empty);
    }
    const links = element('evidence-links');
    links.replaceChildren();
    item.driver.evidence.filter(evidence => safePath(evidence.path)).forEach(evidence => {
      const link = document.createElement('a');
      link.href = evidence.path; link.textContent = evidence.label; link.target = '_blank'; link.rel = 'noopener';
      links.appendChild(link);
    });
    if (item.driver.testUrl && safeWebLink(item.driver.testUrl)) {
      const link = document.createElement('a');
      link.href = item.driver.testUrl; link.textContent = 'Open Kane run'; link.target = '_blank'; link.rel = 'noopener';
      links.appendChild(link);
    }
    const observation = item.observation;
    setText('observation', observation ? [
      'PROTECTED REQUEST', observation.action.toUpperCase() + ' ' + observation.resource,
      'actor: ' + observation.actor, 'response: HTTP ' + observation.status,
      'private data disclosed: ' + (observation.disclosed ? 'yes' : 'no'),
      'stored data changed: ' + (observation.beforeHash !== observation.afterHash ? 'yes' : 'no'),
      'observed: ' + observation.at,
    ].join('\n') : item.driver.summary);
  }
  function show(): void {
    const permissionFailure = active.cases.some(item => {
      const observation = item.observation;
      if (item.verdict !== 'failed' || !observation) return false;
      const successful = observation.status >= 200 && observation.status < 300;
      const changed = observation.beforeHash !== observation.afterHash;
      return item.check.expect === 'deny' ? successful || observation.disclosed || changed
        : !successful || (item.check.action === 'read' ? !observation.disclosed : !changed);
    });
    setText('run-name', active.name);
    setText('engine-label', engineName(active));
    setText('engine-fact', engineName(active));
    setText('revision', active.commit ? active.commit.slice(0, 12) : 'Uncommitted working tree');
    const status = element('run-status');
    status.className = 'status-line ' + active.verdict;
    status.replaceChildren();
    const dot = document.createElement('span'); dot.className = 'dot'; status.appendChild(dot);
    status.appendChild(document.createTextNode(active.verdict === 'passed' ? 'Declared checks passed' : active.verdict === 'failed' ? (permissionFailure ? 'Permission check failed' : 'Browser assertion failed') : 'Verification incomplete'));
    setText('headline', active.verdict === 'passed' ? 'The right users. The right access.' : active.verdict === 'failed' ? (permissionFailure ? 'A permission boundary broke.' : 'The browser proof needs review.') : 'The proof is incomplete.');
    setText('subtitle', active.verdict === 'passed'
      ? 'Forbidden actions were denied, and permitted users could still read and update the protected document.'
      : active.verdict === 'failed'
        ? (permissionFailure ? 'Inspect the user, protected request, and browser evidence. The allowed-user controls show whether legitimate access still works.' : 'The protected requests matched the declared permissions, but browser assertions failed. Inspect the evidence before changing access rules.')
        : 'A missing result, tool error, or absent evidence blocks a verified result. Inspect the affected case before proceeding.');
    const missing = Math.max(0, active.expectedCases - active.cases.length);
    for (const verdict of ['passed', 'failed', 'incomplete'] as const) setText(verdict + '-count', active.cases.filter(item => item.verdict === verdict).length + (verdict === 'incomplete' ? missing : 0));
    setText('contract-hash', 'SHA-256  ' + active.contractHash);
    setText('finished', new Date(active.finishedAt).toLocaleString() + ' · ' + active.expectedCases + ' declared cases');
    const proof = active.engine === 'kane' ? (active.verdict === 'incomplete' ? 'Kane verification incomplete.' : 'Kane evidence for the declared cases.') : 'Local development proof. Kane verification is a separate run.';
    setText('proof-note', proof + (active.repair ? ` ${active.repair.method === 'local-patch' ? 'Reviewed local patch' : 'Codex repair'} · ${active.repair.applied ? 'applied after verification' : 'isolated candidate'}.` : ''));
    element('compare').hidden = !payload.before;
    setText('before', payload.comparison === 'repair' ? 'Before · failed run' : 'Before · seeded bug');
    setText('after', payload.comparison === 'repair' ? (payload.run.verdict === 'passed' ? 'After · verified repair' : 'After · candidate repair') : 'After · corrected policy');
    element('before').setAttribute('aria-pressed', String(active === payload.before));
    element('after').setAttribute('aria-pressed', String(active === payload.run));
    const list = element('case-list');
    list.replaceChildren();
    const filter = element<HTMLSelectElement>('filter').value;
    const items = active.cases.filter(item => filter === 'all' || item.verdict === filter);
    for (const item of items) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'case-button'; button.dataset.case = item.check.id; button.setAttribute('aria-pressed', 'false');
      const title = document.createElement('span'); title.className = 'case-title';
      const label = document.createElement('span'); label.textContent = item.check.id;
      const badge = document.createElement('span'); setBadge(badge, item.verdict); title.append(label, badge);
      const meta = document.createElement('span'); meta.className = 'case-meta';
      meta.textContent = item.actorLabel + ' · ' + item.check.action + ' · expected ' + item.check.expect;
      button.append(title, meta); button.addEventListener('click', () => choose(item));
      row.appendChild(button); list.appendChild(row);
    }
    if (!items.length) {const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'No cases match this filter.'; list.appendChild(empty);}
    if (missing && (filter === 'all' || filter === 'incomplete')) {
      const unrun = document.createElement('li'); unrun.className = 'empty';
      unrun.textContent = missing + ' declared ' + (missing === 1 ? 'case was' : 'cases were') + ' not run.';
      list.appendChild(unrun);
    }
    const first = items.find(item => item.check.id === selected) ?? items.find(item => item.verdict === 'failed') ?? items.find(item => item.verdict === 'incomplete') ?? items[0];
    element('inspector').hidden = !first;
    element('empty-case').hidden = Boolean(first);
    element('case-badge').hidden = !first;
    if (first) choose(first); else setText('case-id', 'Case evidence');
  }
  element('filter').addEventListener('change', show);
  element('before').addEventListener('click', () => {if (payload.before) {active = payload.before; selected = null; show();}});
  element('after').addEventListener('click', () => {active = payload.run; selected = null; show();});
  show();
}
