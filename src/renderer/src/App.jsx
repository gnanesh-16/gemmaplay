import { useEffect, useRef, useState } from 'react';
import MessageContent from './MessageContent.jsx';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return null;
  return (bytes / 1e9).toFixed(2) + ' GB';
}

function rangeBg(value, min, max) {
  const pct = ((value - min) / (max - min)) * 100;
  return { background: `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-3) ${pct}%)` };
}

const PROMPT_MAX_HEIGHT = 240;

export default function App() {
  const [modelInfo, setModelInfo] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSavedFlash, setTokenSavedFlash] = useState(false);

  const [gpuInfo, setGpuInfo] = useState(null);

  const [status, setStatusState] = useState({ state: '', text: 'Not loaded' });
  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [loadPhase, setLoadPhase] = useState('');
  const [loaded, setLoaded] = useState(false);

  const [messages, setMessages] = useState([]);
  const [placeholder, setPlaceholder] = useState(
    'Load Gemma 3 4B on the right, then send a prompt. It runs fully offline on this Mac once downloaded.'
  );

  const [prompt, setPrompt] = useState('Write a compact Python function that returns the nth Fibonacci number iteratively.');
  const [generating, setGenerating] = useState(false);
  const hasConversation = messages.length > 0;

  const [ctxSize, setCtxSize] = useState(4096);
  const [slots, setSlots] = useState(16);
  const [historyTurns, setHistoryTurns] = useState(6);
  const [temperature, setTemperature] = useState(0.7);
  const [topKEnabled, setTopKEnabled] = useState(true);
  const [topK, setTopK] = useState(64);
  const [topPEnabled, setTopPEnabled] = useState(true);
  const [topP, setTopP] = useState(0.95);
  const [repEnabled, setRepEnabled] = useState(false);
  const [repeatPenalty, setRepeatPenalty] = useState(1.15);
  const [maxTokens, setMaxTokens] = useState(512);
  const [prefillEnabled, setPrefillEnabled] = useState(true);
  const [rdAdvise, setRdAdvise] = useState('Off');

  const [tps, setTps] = useState('—');
  const [tokens, setTokens] = useState('—');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const outputRef = useRef(null);
  const promptRef = useRef(null);
  const idCounter = useRef(0);
  const nextId = () => ++idCounter.current;

  useEffect(() => {
    window.api.getModelInfo().then(setModelInfo);
  }, []);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setCtxSize(s.ctxSize);
      setSlots(s.slots);
      setHistoryTurns(s.historyTurns);
      setTemperature(s.temperature);
      setTopKEnabled(s.topKEnabled);
      setTopK(s.topK);
      setTopPEnabled(s.topPEnabled);
      setTopP(s.topP);
      setRepEnabled(s.repEnabled);
      setRepeatPenalty(s.repeatPenalty);
      setMaxTokens(s.maxTokens);
      setPrefillEnabled(s.prefillEnabled);
      setRdAdvise(s.rdAdvise);
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = setTimeout(() => {
      window.api.setSettings({
        ctxSize, slots, historyTurns, temperature, topKEnabled, topK,
        topPEnabled, topP, repEnabled, repeatPenalty, maxTokens, prefillEnabled, rdAdvise,
      });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settingsLoaded, ctxSize, slots, historyTurns, temperature, topKEnabled, topK,
    topPEnabled, topP, repEnabled, repeatPenalty, maxTokens, prefillEnabled, rdAdvise,
  ]);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, PROMPT_MAX_HEIGHT) + 'px';
  }, [prompt]);

  useEffect(() => {
    return window.api.onProgress((data) => {
      if (data.phase === 'download') {
        const pct = data.totalSize ? Math.round((data.downloadedSize / data.totalSize) * 100) : 0;
        setLoadPct(pct);
        setLoadPhase(`Downloading model… ${formatBytes(data.downloadedSize)} / ${formatBytes(data.totalSize)}`);
      } else if (data.phase === 'loading') {
        if (typeof data.pct === 'number') setLoadPct(Math.round(data.pct * 100));
        setLoadPhase('Loading into memory…');
      }
    });
  }, []);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [messages]);

  function setStatus(state, text) {
    setStatusState({ state, text });
  }

  async function handleSaveToken() {
    const value = tokenInput.trim();
    await window.api.setToken(value);
    setModelInfo((m) => (m ? { ...m, hasToken: !!value } : m));
    setTokenInput('');
    setTokenSavedFlash(true);
    setTimeout(() => setTokenSavedFlash(false), 1500);
  }

  async function handleLoad() {
    setLoading(true);
    setLoadPct(0);
    setLoadPhase('Starting…');
    setStatus('busy', 'Loading…');
    setMessages([]);
    setPlaceholder('Downloading and loading Gemma 3 4B — first run downloads about 3.2 GB, cached afterward.');

    const result = await window.api.loadModel({ contextSize: ctxSize });
    setLoading(false);

    if (result.ok) {
      setLoaded(true);
      setStatus('ready', 'Ready');
      setPlaceholder('Gemma 3 4B is loaded and running locally on this Mac. Send a prompt below.');
      window.api.getGpuInfo().then(setGpuInfo);
      window.api.getModelInfo().then(setModelInfo);
    } else {
      setStatus('err', 'Failed to load');
      setPlaceholder(
        result.gated
          ? `Load failed: ${result.message}\n\nThis model is gated on Hugging Face. Open the model page, accept Gemma's usage license, create an access token, and paste it into the Hugging Face token field in the sidebar.`
          : `Load failed: ${result.message}`
      );
    }
  }

  async function handleUnload() {
    await window.api.unloadModel();
    setLoaded(false);
    setGpuInfo(null);
    setMessages([]);
    setStatus('', 'Not loaded');
    setTps('—');
    setTokens('—');
  }

  async function handleClear() {
    await window.api.clearHistory();
    setMessages([]);
    setPlaceholder('Conversation cleared.');
  }

  function updateLastMessage(patch) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = typeof patch === 'function' ? patch(last) : { ...last, ...patch };
      return next;
    });
  }

  async function handleGenerate() {
    if (generating) {
      await window.api.stopGenerate();
      return;
    }
    const text = prompt.trim();
    if (!text || !loaded) return;

    setPrompt('');
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: text },
      { id: nextId(), role: 'assistant', content: '', status: 'streaming' },
    ]);
    setGenerating(true);
    setStatus('busy', 'Generating…');
    setTokens('—');

    let full = '';
    const unsubChunk = window.api.onChunk((chunk) => {
      full += chunk;
      updateLastMessage({ content: full });
    });
    const unsubTick = window.api.onTick(({ tokenCount, elapsedMs }) => {
      setTokens(tokenCount);
      if (elapsedMs > 0) setTps((tokenCount / (elapsedMs / 1000)).toFixed(1));
    });

    try {
      const result = await window.api.generate({
        text,
        temperature,
        topKEnabled,
        topK,
        topPEnabled,
        topP,
        repEnabled,
        repeatPenalty,
        maxTokens,
        historyTurns,
      });
      if (result.ok) {
        setStatus('ready', `Done · ${result.stopReason || 'stop'}`);
        updateLastMessage({ content: full || result.text, status: 'done' });
      } else if (result.aborted) {
        setStatus('ready', 'Stopped');
        updateLastMessage({ content: result.text || full, status: 'stopped' });
      } else {
        setStatus('err', 'Error');
        updateLastMessage({ content: full, status: 'error', error: result.message });
      }
    } finally {
      unsubChunk();
      unsubTick();
      setGenerating(false);
    }
  }

  function handlePromptKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
  }

  function handleTokenKeyDown(e) {
    if (e.key === 'Enter') handleSaveToken();
  }

  const memoryText = gpuInfo?.vramState
    ? formatBytes(gpuInfo.vramState.used ?? gpuInfo.vramState.total)
    : '—';
  const backendText = gpuInfo?.backend ? String(gpuInfo.backend).toUpperCase() : loaded ? 'CPU' : '—';

  return (
    <div className="window">
      <div className="main">
        <div className="titlebar">
          <div className="model-select-wrap">
            <div className={'status-dot' + (status.state ? ' ' + status.state : '')}></div>
            <span className="status-text">{status.text}</span>
          </div>
          <div className="stats">
            <div className="stat"><div className="v">{tps}</div><div className="l">Tok/s</div></div>
            <div className="stat"><div className="v">{tokens}</div><div className="l">Tokens</div></div>
            <div className="stat"><div className="v">{memoryText}</div><div className="l">Memory</div></div>
          </div>
        </div>

        {loading && (
          <div className="loadbar-row show">
            <div className="loadbar-track"><div className="loadbar-fill" style={{ width: loadPct + '%' }}></div></div>
            <div className="loadbar-text">{loadPhase || loadPct + '%'}</div>
          </div>
        )}

        <div className="output-wrap">
          <div className="output" ref={outputRef}>
            {messages.length === 0 ? (
              <span className="placeholder">{placeholder}</span>
            ) : (
              messages.map((m, i) => (
                <div key={m.id} className={'msg ' + m.role}>
                  <div className="msg-role">{m.role === 'user' ? 'You' : 'Gemma'}</div>
                  <div className="msg-body">
                    <MessageContent content={m.content} />
                    {m.status === 'streaming' && i === messages.length - 1 && <span className="cursor"></span>}
                  </div>
                  {m.status === 'stopped' && <div className="msg-status stopped">Stopped</div>}
                  {m.status === 'error' && <div className="msg-status error">Error: {m.error}</div>}
                  {m.role === 'assistant' && m.content && m.status !== 'streaming' && (
                    <button className="icon-btn msg-copy" title="Copy response" onClick={() => navigator.clipboard.writeText(m.content)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="composer">
          <textarea
            id="prompt"
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder="Ask Gemma something…"
            rows={1}
          />
          <div className="composer-bar">
            <button
              className="icon-btn danger"
              title="Clear conversation"
              disabled={!hasConversation}
              onClick={handleClear}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18"></path>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
              </svg>
            </button>
            <button
              className={'gen-btn' + (generating ? ' stop' : '')}
              disabled={!generating && (!loaded || !prompt.trim())}
              title={!generating && loaded && !prompt.trim() ? 'Type a prompt first' : undefined}
              onClick={handleGenerate}
            >
              {generating ? (<><span className="spinner"></span>Stop</>) : '↑ Generate'}
            </button>
          </div>
        </div>
      </div>

      <div className="sidebar">
        <h3>Model</h3>
        <div className="row">
          <div className="help">
            Gemma 3 4B, Q4_0 (QAT) — ~3.2 GB. Downloaded once from{' '}
            <a href={`https://huggingface.co/${modelInfo?.repo || 'google/gemma-3-4b-it-qat-q4_0-gguf'}`} target="_blank" rel="noreferrer">
              google/{modelInfo?.repo?.split('/')[1] || 'gemma-3-4b-it-qat-q4_0-gguf'}
            </a>{' '}
            on Hugging Face, cached on this Mac afterward.
            {modelInfo && (modelInfo.cached ? ' Already downloaded.' : ' Not downloaded yet.')}
          </div>
        </div>
        <div className="row">
          <div className="row-top"><div className="row-label">Hugging Face token</div></div>
          <div className="stepper" style={{ gap: 8 }}>
            <input
              type="password"
              placeholder={modelInfo?.hasToken ? 'Token saved — enter a new one to replace' : 'hf_…'}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={handleTokenKeyDown}
              style={{ flex: 1, width: 'auto', textAlign: 'left' }}
            />
            <button
              className="load-btn"
              style={{ width: 'auto', padding: '8px 14px', marginTop: 0 }}
              disabled={!tokenInput.trim()}
              onClick={handleSaveToken}
            >
              {tokenSavedFlash ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          <div className="help">
            Gemma is gated on Hugging Face. Accept the license on the{' '}
            <a href={`https://huggingface.co/${modelInfo?.repo || 'google/gemma-3-4b-it-qat-q4_0-gguf'}`} target="_blank" rel="noreferrer">model page</a>{' '}
            and create a token at{' '}
            <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">huggingface.co/settings/tokens</a>.
          </div>
        </div>
        <button className="load-btn" disabled={loading} onClick={handleLoad}>
          {loading ? (<><span className="spinner"></span>{loadPhase ? 'Loading…' : 'Starting…'}</>) : (loaded ? 'Reload Model' : 'Load Model')}
        </button>

        <div className="divider"></div>

        <h3>Memory</h3>
        <div className="row">
          <div className="row-top">
            <div className="row-label">Context</div>
            <div className="row-select-wrap">
              <select className="row-select" value={ctxSize} onChange={(e) => setCtxSize(Number(e.target.value))}>
                <option value={1024}>1K</option>
                <option value={2048}>2K</option>
                <option value={4096}>4K, Default</option>
                <option value={8192}>8K</option>
              </select>
              <span className="chevron">⌄</span>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="row-top">
            <div className="row-label">Slots</div>
            <div className="row-select-wrap">
              <select className="row-select" value={slots} onChange={(e) => setSlots(Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={16}>16, Default</option>
                <option value={32}>32</option>
              </select>
              <span className="chevron">⌄</span>
            </div>
          </div>
          <div className="help">Gemma 3 4B is a dense model, not mixture-of-experts, so this has no effect on generation — kept as a visual placeholder only.</div>
        </div>
        <div className="row">
          <div className="row-top"><div className="row-label">History kept</div><div className="row-value">{historyTurns} turns</div></div>
          <input type="range" min={1} max={20} value={historyTurns} style={rangeBg(historyTurns, 1, 20)} onChange={(e) => setHistoryTurns(Number(e.target.value))} />
          <div className="help">This caps how many past turns stay in the model's chat history each generation.</div>
        </div>

        <h3>Generation</h3>
        <div className="row">
          <div className="row-top"><div className="row-label">Temperature</div><div className="row-value">{temperature.toFixed(2)}</div></div>
          <input type="range" min={0} max={2} step={0.01} value={temperature} style={rangeBg(temperature, 0, 2)} onChange={(e) => setTemperature(parseFloat(e.target.value))} />
          <div className="help">0 uses deterministic greedy decoding. Higher values make sampling more varied.</div>
        </div>
        <div className="row">
          <div className="row-top">
            <div className="row-label">Top-K</div>
            <label className="toggle">
              <input type="checkbox" checked={topKEnabled} onChange={(e) => setTopKEnabled(e.target.checked)} />
              <span className="track"></span><span className="thumb"></span>
            </label>
          </div>
        </div>
        <div className="row">
          <div className="row-top">
            <div className="row-label">K value</div>
            <div className="row-select-wrap">
              <input
                className="row-select"
                type="number"
                min={1}
                max={512}
                value={topK}
                disabled={!topKEnabled}
                onChange={(e) => setTopK(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="row-top">
            <div className="row-label">Top-P</div>
            <label className="toggle">
              <input type="checkbox" checked={topPEnabled} onChange={(e) => setTopPEnabled(e.target.checked)} />
              <span className="track"></span><span className="thumb"></span>
            </label>
          </div>
          <div className="slider-row">
            <input type="range" min={0.05} max={1} step={0.01} value={topP} disabled={!topPEnabled} style={topPEnabled ? rangeBg(topP, 0.05, 1) : undefined} onChange={(e) => setTopP(parseFloat(e.target.value))} />
            <span className="val">{topP.toFixed(2)}</span>
          </div>
        </div>
        <div className="row">
          <div className="row-top">
            <div className="row-label">Repetition penalty</div>
            <label className="toggle">
              <input type="checkbox" checked={repEnabled} onChange={(e) => setRepEnabled(e.target.checked)} />
              <span className="track"></span><span className="thumb"></span>
            </label>
          </div>
          <div className="slider-row">
            <input type="range" min={1} max={1.5} step={0.01} value={repeatPenalty} disabled={!repEnabled} style={repEnabled ? rangeBg(repeatPenalty, 1, 1.5) : undefined} onChange={(e) => setRepeatPenalty(parseFloat(e.target.value))} />
            <span className="val">{repeatPenalty.toFixed(2)}</span>
          </div>
          <div className="help">llama.cpp's repeat penalty. 1.00 = off; higher values discourage reusing recent tokens.</div>
        </div>
        <div className="row">
          <div className="row-top"><div className="row-label">Max output tokens</div></div>
          <div className="stepper">
            <input type="number" value={maxTokens} min={16} max={4096} step={16} onChange={(e) => setMaxTokens(Number(e.target.value))} />
          </div>
        </div>

        <h3>Runtime</h3>
        <div className="row">
          <div className="row-top">
            <div className="row-label">Backend</div>
          </div>
          <div className="segmented">
            <button className="seg-btn active" disabled>{backendText}</button>
          </div>
          <div className="help">
            {gpuInfo?.deviceNames?.length ? gpuInfo.deviceNames.join(', ') : 'Runs via llama.cpp — Metal-accelerated on Apple Silicon, CPU otherwise.'}
          </div>
        </div>
        <div className="row">
          <div className="row-top">
            <div className="row-label">Prefill</div>
            <label className="toggle">
              <input type="checkbox" checked={prefillEnabled} onChange={(e) => setPrefillEnabled(e.target.checked)} />
              <span className="track"></span><span className="thumb"></span>
            </label>
          </div>
        </div>
        <div className="row">
          <div className="row-top"><div className="row-label">RDADVISE</div></div>
          <div className="segmented">
            {['Off', 'Default', 'Bounded', 'Adaptive'].map((opt) => (
              <button
                key={opt}
                className={'seg-btn' + (rdAdvise === opt ? ' active' : '')}
                onClick={() => setRdAdvise(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="help">RDADVISE is experimental. It may speed up short decodes but slow down long decodes.</div>
        </div>

        <div className="divider"></div>
        <button
          className="load-btn"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
          disabled={!loaded}
          onClick={handleUnload}
        >
          Unload Model
        </button>
      </div>
    </div>
  );
}
