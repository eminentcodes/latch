const form = document.getElementById('launch-form');
const startButton = document.getElementById('start');
const accessCode = document.getElementById('access-code');
const status = document.getElementById('status');
const session = document.getElementById('session');
const workspace = document.getElementById('workspace');
const stopButton = document.getElementById('stop');
let timer;
let busy = false;

async function request(method = 'GET', body) {
  const response = await fetch('/api/session', {method, credentials: 'same-origin', cache: 'no-store',
    ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The session could not be read.');
  return data;
}
function show(data) {
  clearTimeout(timer);
  startButton.disabled = !data.enabled || busy;
  document.getElementById('engine-note').textContent = data.kaneEnabled ? 'Fresh browser and native Kane verification are available.' : 'The quick check generates fresh browser evidence. Native Kane is not configured for this deployment.';
  if (data.state === 'ready') {
    const url = new URL(data.workspaceUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The workspace address is invalid.');
    workspace.href = url.href;
    workspace.hidden = false;
    session.hidden = false;
    form.hidden = true;
    status.textContent = 'Your live demo is ready. Open the workspace to try both apps and generate fresh checks.';
    document.getElementById('expires').textContent = 'Session ends at ' + new Date(data.expiresAt).toLocaleTimeString() + '. Download your evidence before then.';
    timer = setTimeout(load, Math.max(1000, Date.parse(data.expiresAt) - Date.now() + 1000));
    return;
  }
  session.hidden = true;
  if (['starting', 'installing', 'building'].includes(data.state)) {
    session.hidden = false;
    workspace.hidden = true;
    document.getElementById('expires').textContent = 'You can end the session while it prepares.';
    form.hidden = true;
    status.textContent = data.message ?? 'Preparing your live demo...';
    timer = setTimeout(load, 3000);
    return;
  }
  form.hidden = false;
  if (data.state === 'error' && data.expiresAt) {
    session.hidden = false;
    workspace.hidden = true;
    document.getElementById('expires').textContent = 'End this session before trying again.';
  }
  status.textContent = data.message ?? (data.enabled ? 'Enter the judge access code to create your live session.' : 'The owner has not enabled live sessions yet. You can inspect the recorded Kane proof below.');
}
async function load() {
  try {show(await request());} catch (error) {
    clearTimeout(timer);
    form.hidden = false;
    status.textContent = error.message;
    startButton.disabled = false;
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  startButton.disabled = true;
  status.textContent = 'Preparing your isolated demo...';
  try {
    const data = await request('POST', {accessCode: accessCode.value});
    accessCode.value = '';
    show(data);
  } catch (error) {status.textContent = error.message;}
  finally {busy = false; startButton.disabled = false;}
});
stopButton.addEventListener('click', async () => {
  stopButton.disabled = true;
  clearTimeout(timer);
  try {await request('DELETE'); session.hidden = true; form.hidden = false; await load();}
  catch (error) {status.textContent = error.message;}
  finally {stopButton.disabled = false;}
});
load();
