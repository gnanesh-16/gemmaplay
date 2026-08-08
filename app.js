import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const $ = (id) => document.getElementById(id);
const modelSelect = $('modelSelect'), statusDot = $('statusDot'), statusText = $('statusText');
const statTps = $('statTps'), statTokens = $('statTokens'), statMem = $('statMem');
const loadRow = $('loadRow'), loadFill = $('loadFill'), loadText = $('loadText');
const output = $('output'), promptEl = $('prompt'), genBtn = $('genBtn'), clearBtn = $('clearBtn');
const loadBtn = $('loadBtn'), unloadBtn = $('unloadBtn'), sizeHint = $('sizeHint'), modelHelp = $('modelHelp');
const ctxSelect = $('ctxSelect'), histSlider = $('histSlider'), histVal = $('histVal');
const tempSlider = $('tempSlider'), tempVal = $('tempVal');
const topPToggle = $('topPToggle'), topPSlider = $('topPSlider'), topPVal = $('topPVal');
const repToggle = $('repToggle'), repSlider = $('repSlider'), repVal = $('repVal');
const maxTokens = $('maxTokens'), streamToggle = $('streamToggle');
const gpuWarning = $('gpuWarning'), gpuAdapterText = $('gpuAdapterText');

let engine = null;
let modelList = [];
let history = []; // {role, content}
let generating = false;
let currentController = null;

function setStatus(state, text){
  statusDot.className = 'status-dot' + (state ? ' ' + state : '');
  statusText.textContent = text;
}

// --- GPU feature detection ---
(async () => {
  if (!('gpu' in navigator)) {
    gpuWarning.style.display = 'block';
    gpuWarning.textContent = "This browser doesn't expose WebGPU, so nothing here can run. Open this file in a recent desktop Chrome or Edge (WebGPU is off by default in most other browsers).";
    gpuAdapterText.textContent = 'No navigator.gpu — WebGPU unavailable.';
    loadBtn.disabled = true;
    return;
  }
  try{
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter){
      gpuWarning.style.display = 'block';
      gpuWarning.textContent = 'WebGPU is present but no adapter could be acquired. A GPU-capable device is required to run the model locally.';
      gpuAdapterText.textContent = 'No adapter available.';
      loadBtn.disabled = true;
    } else {
      const info = adapter.info || {};
      gpuAdapterText.textContent = `Adapter: ${info.vendor || 'unknown vendor'} / ${info.architecture || info.device || 'GPU'}`;
    }
  } catch(e){
    gpuAdapterText.textContent = 'Could not query adapter info.';
  }
})();

// --- populate model list (only real Gemma builds WebLLM ships) ---
(async () => {
  try {
    modelList = webllm.prebuiltAppConfig.model_list.filter(m => /gemma/i.test(m.model_id));
    if (modelList.length === 0){
      modelSelect.innerHTML = '<option>No Gemma builds found in this WebLLM version</option>';
      return;
    }
    modelSelect.innerHTML = modelList.map((m,i) =>
      `<option value="${i}">${m.model_id}</option>`).join('');
    updateModelHint();
  } catch(e){
    modelSelect.innerHTML = '<option>Failed to load model registry</option>';
    output.innerHTML = `<span class="placeholder">Couldn't reach the WebLLM model registry (${e.message}). Check your connection and reload this page.</span>`;
  }
})();

function updateModelHint(){
  const m = modelList[modelSelect.value];
  if (!m) return;
  const vram = m.vram_required_MB ? (m.vram_required_MB/1024).toFixed(1) + ' GB VRAM' : 'VRAM unknown';
  modelHelp.textContent = `${m.model_id} — approx. ${vram}. Downloaded once from Hugging Face (mlc-ai repo) and cached in this browser afterward.`;
  statMem.textContent = m.vram_required_MB ? (m.vram_required_MB/1024).toFixed(1)+' GB' : '—';
}
modelSelect.addEventListener('change', updateModelHint);

// --- sliders/toggles wiring ---
histSlider.addEventListener('input', () => histVal.textContent = histSlider.value + ' turns');
tempSlider.addEventListener('input', () => tempVal.textContent = parseFloat(tempSlider.value).toFixed(2));
topPSlider.addEventListener('input', () => topPVal.textContent = parseFloat(topPSlider.value).toFixed(2));
repSlider.addEventListener('input', () => repVal.textContent = parseFloat(repSlider.value).toFixed(2));
topPToggle.addEventListener('change', () => topPSlider.disabled = !topPToggle.checked);
repToggle.addEventListener('change', () => repSlider.disabled = !repToggle.checked);

// --- load model ---
loadBtn.addEventListener('click', async () => {
  const m = modelList[modelSelect.value];
  if (!m) return;
  loadBtn.disabled = true; modelSelect.disabled = true;
  loadRow.classList.add('show');
  setStatus('busy', 'Loading…');
  output.innerHTML = '<span class="placeholder">Downloading and compiling shaders — first load can take a while depending on model size and connection speed…</span>';

  try{
    const ctxSize = parseInt(ctxSelect.value, 10);
    engine = await webllm.CreateMLCEngine(m.model_id, {
      initProgressCallback: (report) => {
        const pct = Math.round((report.progress || 0) * 100);
        loadFill.style.width = pct + '%';
        loadText.textContent = pct + '%';
        setStatus('busy', report.text || 'Loading…');
      }
    }, {
      context_window_size: ctxSize
    });
    setStatus('ready', 'Ready');
    genBtn.disabled = false;
    unloadBtn.disabled = false;
    loadBtn.textContent = 'Reload Model';
    loadBtn.disabled = false;
    modelSelect.disabled = false;
    loadRow.classList.remove('show');
    output.innerHTML = `<span class="placeholder">${m.model_id} is loaded and running locally on your GPU. Send a prompt below.</span>`;
  } catch(e){
    setStatus('err', 'Failed to load');
    loadRow.classList.remove('show');
    loadBtn.disabled = false; modelSelect.disabled = false;
    output.innerHTML = `<span class="placeholder">Load failed: ${e.message}</span>`;
  }
});

unloadBtn.addEventListener('click', async () => {
  if (!engine) return;
  await engine.unload();
  engine = null;
  genBtn.disabled = true;
  unloadBtn.disabled = true;
  loadBtn.textContent = 'Load Model';
  setStatus(null, 'Not loaded');
  statTps.textContent = '—'; statTokens.textContent = '—';
});

clearBtn.addEventListener('click', () => {
  history = [];
  output.innerHTML = '<span class="placeholder">Conversation cleared.</span>';
});

// --- generate ---
genBtn.addEventListener('click', async () => {
  if (generating){
    currentController?.abort();
    engine?.interruptGenerate?.();
    return;
  }
  const text = promptEl.value.trim();
  if (!text || !engine) return;

  history.push({ role: 'user', content: text });
  const trimmed = history.slice(-2 * parseInt(histSlider.value, 10));

  generating = true;
  genBtn.textContent = '■ Stop';
  genBtn.classList.add('stop');
  setStatus('busy', 'Generating…');
  output.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  output.appendChild(cursor);

  const params = {
    messages: trimmed,
    temperature: parseFloat(tempSlider.value),
    max_tokens: parseInt(maxTokens.value, 10),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (topPToggle.checked) params.top_p = parseFloat(topPSlider.value);
  if (repToggle.checked) params.frequency_penalty = parseFloat(repSlider.value);

  let full = '';
  const t0 = performance.now();
  let completionTokens = 0;

  try{
    const stream = await engine.chat.completions.create(params);
    for await (const chunk of stream){
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta){
        full += delta;
        output.textContent = full;
        output.appendChild(cursor);
        output.scrollTop = output.scrollHeight;
      }
      if (chunk.usage){
        completionTokens = chunk.usage.completion_tokens || completionTokens;
        const dtps = chunk.usage.extra?.decode_tokens_per_s;
        statTps.textContent = dtps ? dtps.toFixed(1) : ((completionTokens/((performance.now()-t0)/1000)).toFixed(1));
        statTokens.textContent = completionTokens;
      }
    }
    history.push({ role: 'assistant', content: full });
  } catch(e){
    output.textContent = full + `\n\n[stopped: ${e.message}]`;
  } finally {
    cursor.remove();
    generating = false;
    genBtn.textContent = '↑ Generate';
    genBtn.classList.remove('stop');
    setStatus('ready', 'Ready');
    if (!statTokens.textContent || statTokens.textContent === '—'){
      statTokens.textContent = completionTokens || full.split(/\s+/).length;
    }
  }
});

promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) genBtn.click();
});
