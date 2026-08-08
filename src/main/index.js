const { app, shell, screen, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { is } = require('@electron-toolkit/utils');

const HF_REPO = 'google/gemma-3-4b-it-qat-q4_0-gguf';
const HF_FILE = 'gemma-3-4b-it-q4_0.gguf';
const HF_FILE_URL = `https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILE}`;

const DEFAULT_SETTINGS = {
  ctxSize: 4096,
  historyTurns: 6,
  temperature: 0.7,
  topKEnabled: true,
  topK: 64,
  topPEnabled: true,
  topP: 0.95,
  repEnabled: false,
  repeatPenalty: 1.15,
  maxTokens: 512,
  slots: 16,
  prefillEnabled: true,
  rdAdvise: 'Off',
};

const modelsDir = path.join(app.getPath('userData'), 'models');
const configPath = path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;
let llamaModulePromise = null;
let llama = null;
let model = null;
let context = null;
let session = null;
let currentAbortController = null;

function getLlamaModule() {
  if (!llamaModulePromise) llamaModulePromise = import('node-llama-cpp');
  return llamaModulePromise;
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
  return next;
}

function getSavedBounds() {
  const b = readConfig().windowBounds;
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width < 200 || b.height < 200) {
    return null;
  }
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    if (!onScreen) return { width: b.width, height: b.height };
  }
  return b;
}

let saveBoundsTimer = null;
function scheduleSaveBounds() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    writeConfig({ windowBounds: mainWindow.getBounds() });
  }, 400);
}

async function disposeModel() {
  currentAbortController?.abort();
  currentAbortController = null;
  session = null;
  try { await context?.dispose(); } catch {}
  try { await model?.dispose(); } catch {}
  context = null;
  model = null;
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const savedBounds = getSavedBounds();

  mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1400,
    height: savedBounds?.height ?? 900,
    x: savedBounds?.x,
    y: savedBounds?.y,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0d',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 20, y: 20 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

ipcMain.handle('model:get-info', () => {
  const config = readConfig();
  return {
    repo: HF_REPO,
    file: HF_FILE,
    hasToken: !!config.hfToken,
    cached: fs.existsSync(path.join(modelsDir, HF_FILE)),
  };
});

ipcMain.handle('model:set-token', (_event, token) => {
  writeConfig({ hfToken: token || '' });
  return { ok: true };
});

ipcMain.handle('settings:get', () => {
  return { ...DEFAULT_SETTINGS, ...(readConfig().settings || {}) };
});

ipcMain.handle('settings:set', (_event, patch) => {
  writeConfig({ settings: { ...(readConfig().settings || {}), ...patch } });
  return { ok: true };
});

ipcMain.handle('model:load', async (_event, { contextSize }) => {
  try {
    await disposeModel();
    const { getLlama, resolveModelFile, LlamaChatSession } = await getLlamaModule();
    const config = readConfig();

    if (!llama) llama = await getLlama();

    const modelPath = await resolveModelFile(HF_FILE_URL, {
      directory: modelsDir,
      fileName: HF_FILE,
      headers: config.hfToken ? { Authorization: `Bearer ${config.hfToken}` } : undefined,
      onProgress: ({ totalSize, downloadedSize }) => {
        mainWindow?.webContents.send('model:progress', {
          phase: 'download',
          downloadedSize,
          totalSize,
        });
      },
    });

    mainWindow?.webContents.send('model:progress', { phase: 'loading' });
    model = await llama.loadModel({
      modelPath,
      onLoadProgress: (pct) => {
        mainWindow?.webContents.send('model:progress', { phase: 'loading', pct });
      },
    });
    context = await model.createContext({ contextSize });
    session = new LlamaChatSession({ contextSequence: context.getSequence() });

    return { ok: true };
  } catch (e) {
    const message = String(e?.message || e);
    const gated = /401|403|gated|access/i.test(message);
    return { ok: false, gated, message };
  }
});

ipcMain.handle('model:unload', async () => {
  await disposeModel();
  return { ok: true };
});

ipcMain.handle('model:clear-history', () => {
  session?.resetChatHistory();
  return { ok: true };
});

ipcMain.handle('gpu:info', async () => {
  if (!llama) return { backend: null };
  const vramState = await llama.getVramState().catch(() => null);
  const deviceNames = await llama.getGpuDeviceNames().catch(() => []);
  return {
    backend: llama.gpu || 'cpu',
    deviceNames,
    vramState,
  };
});

ipcMain.handle('chat:generate', async (_event, opts) => {
  if (!session) return { ok: false, message: 'Model not loaded' };

  const { text, temperature, topKEnabled, topK, topPEnabled, topP, repEnabled, repeatPenalty, maxTokens, historyTurns } = opts;

  const history = session.getChatHistory();
  const maxItems = 2 * historyTurns;
  if (history.length > maxItems) {
    session.setChatHistory(history.slice(-maxItems));
  }

  currentAbortController = new AbortController();
  let full = '';
  let tokenCount = 0;
  const t0 = Date.now();

  const promptOptions = {
    maxTokens,
    temperature,
    signal: currentAbortController.signal,
    stopOnAbortSignal: true,
    onTextChunk: (chunk) => {
      full += chunk;
      mainWindow?.webContents.send('chat:chunk', chunk);
    },
    onToken: (tokens) => {
      tokenCount += tokens.length;
      const elapsedMs = Date.now() - t0;
      mainWindow?.webContents.send('chat:tick', { tokenCount, elapsedMs });
    },
  };
  if (topKEnabled) promptOptions.topK = topK;
  if (topPEnabled) promptOptions.topP = topP;
  if (repEnabled) promptOptions.repeatPenalty = { penalty: repeatPenalty };

  try {
    const result = await session.promptWithMeta(text, promptOptions);
    return { ok: true, text: full || result.responseText, stopReason: result.stopReason, tokenCount };
  } catch (e) {
    return { ok: false, aborted: true, text: full, message: String(e?.message || e) };
  } finally {
    currentAbortController = null;
  }
});

ipcMain.handle('chat:stop', () => {
  currentAbortController?.abort();
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  clearTimeout(saveBoundsTimer);
  if (mainWindow && !mainWindow.isDestroyed()) {
    writeConfig({ windowBounds: mainWindow.getBounds() });
  }
  await disposeModel();
});
