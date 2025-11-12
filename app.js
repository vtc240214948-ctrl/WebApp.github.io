// app.js (ES module)
// Simple client-side runner with Pyodide and sandboxed iframe for JS
const outEl = document.getElementById('out');
const codeEl = document.getElementById('code');
const langEl = document.getElementById('lang');
const runBtn = document.getElementById('run');
const stopBtn = document.getElementById('stop');
const saveBtn = document.getElementById('save');
const downloadBtn = document.getElementById('download');
const snippetsSelect = document.getElementById('snippets');
const loadSnippetBtn = document.getElementById('loadSnippet');
const deleteSnippetBtn = document.getElementById('deleteSnippet');

let pyodide = null;
let pyodideReady = false;
let currentIframe = null;
let runTimeout = null;

const SNIPPETS_KEY = 'code_runner_snippets_v1';

function logOut(text) {
  outEl.textContent += text + '\n';
  outEl.scrollTop = outEl.scrollHeight;
}

function setOutput(text) {
  outEl.textContent = text;
}

async function initPyodide() {
  if (pyodideReady) return;
  setOutput('Loading Pyodide (this may take a while)...');
  // load pyodide script
  await import('https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js').then(async (m) => {
    // loadPyodide is attached to global
    // eslint-disable-next-line no-undef
    pyodide = await loadPyodide({indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/"});
    pyodideReady = true;
    setOutput('Pyodide ready.');
  }).catch((e) => {
    setOutput('Failed to load Pyodide: ' + e);
  });
}

function createSandboxedIframe(code) {
  // remove previous iframe if any
  if (currentIframe) {
    currentIframe.remove();
    currentIframe = null;
  }
  // create blob with HTML that captures console and posts messages to parent
  const iframeHtml = `
<!doctype html>
<html>
<body>
<script>
  // capture console methods and forward to parent
  (function(){
    function send(type, args){
      try {
        parent.postMessage({type:type, data: args.map(a=>String(a))}, '*');
      } catch(e){}
    }
    console.log = function(){ send('log', Array.from(arguments)); };
    console.error = function(){ send('error', Array.from(arguments)); };
    console.warn = function(){ send('warn', Array.from(arguments)); };
    console.info = function(){ send('info', Array.from(arguments)); };
    window.addEventListener('error', function(e){
      send('error', [e && e.message ? e.message : String(e)]);
    });
    // run user code
    try {
      ${code}
    } catch (e) {
      send('error', [e && e.stack ? e.stack : String(e)]);
    }
  })();
<\/script>
</body>
</html>`;
  const blob = new Blob([iframeHtml], {type: 'text/html'});
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  // sandboxed: allow-scripts only (no same-origin, no forms, no top-navigation)
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  currentIframe = iframe;
  return iframe;
}

function stopRunning() {
  if (currentIframe) {
    currentIframe.remove();
    currentIframe = null;
  }
  if (runTimeout) {
    clearTimeout(runTimeout);
    runTimeout = null;
  }
  stopBtn.disabled = true;
  runBtn.disabled = false;
  logOut('Execution stopped.');
}

window.addEventListener('message', (ev) => {
  // messages from iframe
  if (!ev.data || !ev.data.type) return;
  const {type, data} = ev.data;
  if (type === 'log') {
    data.forEach(d => logOut(String(d)));
  } else if (type === 'error') {
    data.forEach(d => logOut('[Error] ' + String(d)));
  } else if (type === 'warn') {
    data.forEach(d => logOut('[Warn] ' + String(d)));
  } else if (type === 'info') {
    data.forEach(d => logOut('[Info] ' + String(d)));
  }
});

async function runJS(code) {
  setOutput('Running JavaScript (sandboxed)...');
  // create sanitized wrapper — run in iframe
  // If user wants DOM access, we must change sandbox but that's unsafe.
  createSandboxedIframe(code);
  // default timeout (e.g., 8s) to auto-stop runaway scripts
  runTimeout = setTimeout(() => {
    if (currentIframe) {
      logOut('Time limit reached — stopping script.');
      stopRunning();
    }
  }, 8000);
  stopBtn.disabled = false;
  runBtn.disabled = true;
}

async function runPython(code) {
  if (!pyodideReady) {
    await initPyodide();
  }
  if (!pyodideReady) {
    setOutput('Pyodide not available.');
    return;
  }
  setOutput('Running Python...');
  stopBtn.disabled = false;
  runBtn.disabled = true;
  // run with captured stdout/stderr
  try {
    // indent user code and safely execute
    const indented = code.split('\n').map(l => l || '').map(l => '    ' + l).join('\n');
    const wrapper = `
import sys, io, asyncio, traceback
_buf = io.StringIO()
_sys_stdout = sys.stdout
_sys_stderr = sys.stderr
sys.stdout = _buf
sys.stderr = _buf
try:
${indented}
except Exception:
    traceback.print_exc()
finally:
    sys.stdout = _sys_stdout
    sys.stderr = _sys_stderr
_buf.getvalue()
`;
    const result = await pyodide.runPythonAsync(wrapper);
    setOutput(String(result));
  } catch (e) {
    setOutput('Error: ' + e);
  } finally {
    stopBtn.disabled = true;
    runBtn.disabled = false;
  }
}

runBtn.addEventListener('click', async () => {
  setOutput('');
  if (langEl.value === 'javascript') {
    // For JS, we wrap in an IIFE to avoid leaking globals:
    // But we already run inside sandboxed iframe.
    await runJS(codeEl.value);
  } else {
    await runPython(codeEl.value);
  }
});

stopBtn.addEventListener('click', () => {
  stopRunning();
});

// snippet management
function loadSnippets() {
  const raw = localStorage.getItem(SNIPPETS_KEY);
  let arr = [];
  try { arr = raw ? JSON.parse(raw) : []; } catch(e){ arr = []; }
  snippetsSelect.innerHTML = '';
  arr.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = s.title || `Snippet ${i+1}`;
    snippetsSelect.appendChild(opt);
  });
  return arr;
}

function saveSnippets(arr) {
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(arr));
}

saveBtn.addEventListener('click', () => {
  const title = prompt('Snippet title:', 'My snippet') || 'Snippet';
  const arr = loadSnippets();
  arr.push({title, lang: langEl.value, code: codeEl.value, created: Date.now()});
  saveSnippets(arr);
  renderSnippets();
});

function renderSnippets() {
  loadSnippets();
}

loadSnippetBtn.addEventListener('click', () => {
  const idx = Number(snippetsSelect.value);
  const arr = loadSnippets();
  if (!arr[idx]) return alert('Invalid snippet');
  langEl.value = arr[idx].lang || 'python';
  codeEl.value = arr[idx].code || '';
});

deleteSnippetBtn.addEventListener('click', () => {
  const idx = Number(snippetsSelect.value);
  const arr = loadSnippets();
  if (!arr[idx]) return alert('Invalid snippet');
  if (!confirm('Delete snippet "' + (arr[idx].title||'') + '"?')) return;
  arr.splice(idx, 1);
  saveSnippets(arr);
  renderSnippets();
});

// download code as file
downloadBtn.addEventListener('click', () => {
  const blob = new Blob([codeEl.value], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const ext = langEl.value === 'python' ? 'py' : 'js';
  a.download = `snippet.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// warm up: load snippets & optionally pre-load pyodide lazily
renderSnippets();

// Preload pyodide in background when user opens page and selects python
langEl.addEventListener('change', async () => {
  if (langEl.value === 'python' && !pyodideReady) {
    initPyodide();
  }
});

// Register service worker for PWA caching (optional)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(()=>{/* ignore errors */});
}
