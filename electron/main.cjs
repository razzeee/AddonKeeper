const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const AdmZip = require('adm-zip');

const isDev = process.env.ELECTRON_DEV === '1';

/**
 * Find addon folders inside an extracted zip directory by locating all .toc files.
 * Each .toc file's parent directory is an addon folder.
 * The canonical install name is derived from the .toc filename (minus extension),
 * which is the authoritative WoW addon folder name.
 *
 * @param {string} tmpDir - root of the extracted zip
 * @returns {{ name: string, path: string }[]}
 */
function findAddonFoldersViaToc(tmpDir) {
  const addonFolders = new Map(); // installName -> srcPath (deduplicated)

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    const tocs = entries.filter(f => f.endsWith('.toc'));
    if (tocs.length > 0) {
      // This directory contains .toc files — it is an addon folder.
      // Use the .toc filename (without extension) as the canonical install name.
      const installName = path.basename(tocs[0], '.toc');
      if (!addonFolders.has(installName)) {
        addonFolders.set(installName, dir);
      }
      // Don't recurse further into an addon folder
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      try {
        if (fs.statSync(entryPath).isDirectory()) walk(entryPath);
      } catch { /* skip */ }
    }
  }

  walk(tmpDir);
  return Array.from(addonFolders.entries()).map(([name, srcPath]) => ({ name, path: srcPath }));
}

// Config file path
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// --- Config helpers ---
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return { addonsPath: '', addonSources: {}, pinnedAddons: [] };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// --- TOC parser ---
function parseToc(tocPath) {
  const content = fs.readFileSync(tocPath, 'utf8');
  const meta = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^##\s*([\w-]+)\s*:\s*(.+)/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  return meta;
}

// Extract GitHub owner/repo from various TOC fields
function extractGitHubRepo(meta) {
  const fields = [
    meta['x-github-repository'],
    meta['x-github'],
    meta['x-website'],
    meta['x-url'],
  ].filter(Boolean);

  for (const field of fields) {
    const m = field.match(/github\.com[/:]([^/\s]+\/[^/\s#?]+)/);
    if (m) {
      return m[1].replace(/\.git$/, '');
    }
    // bare "owner/repo" format
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(field)) {
      return field;
    }
  }
  return null;
}

// --- Scan addons directory ---
function getGitVersion(dir) {
  // Synchronously get the short HEAD SHA — used during scan
  try {
    const { execFileSync } = require('child_process');
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    return sha || null;
  } catch (e) { return null; }
}

function scanAddons(addonsPath) {
  if (!addonsPath || !fs.existsSync(addonsPath)) return [];

  const config = loadConfig();
  const addonSources = config.addonSources || {};
  const pinnedAddons = config.pinnedAddons || [];

  const entries = fs.readdirSync(addonsPath, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  return entries.map(name => {
    const dir = path.join(addonsPath, name);
    const tocFiles = fs.readdirSync(dir).filter(f => f.endsWith('.toc'));
    let version = null;
    let detectedRepo = null;
    const isGitRepo = fs.existsSync(path.join(dir, '.git'));

    for (const toc of tocFiles) {
      const meta = parseToc(path.join(dir, toc));
      if (meta['version']) version = meta['version'];
      const repo = extractGitHubRepo(meta);
      if (repo && !detectedRepo) detectedRepo = repo;
    }

    // Git SHA overrides TOC version when the folder is a git repo
    if (isGitRepo) {
      const gitSha = getGitVersion(dir);
      if (gitSha) version = gitSha;
    }

    const savedSource = addonSources[name];
    const source = savedSource || (detectedRepo ? `https://github.com/${detectedRepo}` : null);
    const repoSlug = savedSource
      ? savedSource.match(/github\.com[/:]([^/\s]+\/[^/\s#?]+)/)?.[1]?.replace(/\.git$/, '') || null
      : detectedRepo;

    return {
      name,
      version,
      source,
      repoSlug,
      hasSource: !!source,
      isGitRepo,
      pinned: pinnedAddons.includes(name),
      status: 'idle',
    };
  });
}

// --- HTTP(S) GET helper ---
function httpsGet(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'AscensionAddonUpdater/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsGet(res.headers.location, redirectCount + 1));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

function downloadBinary(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'AscensionAddonUpdater/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(downloadBinary(res.headers.location, redirectCount + 1));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

// Fetch the remote TOC version for a repo by looking for a .toc file on the default branch.
// addonName: the local addon folder name (e.g. "ElvUI_AddOnSkins") — used to pick the right
// .toc in collection repos that contain multiple addon subdirectories.
async function getRemoteTocVersion(repoSlug, addonName) {
  // Get default branch + tree
  const repoRes = await httpsGet(`https://api.github.com/repos/${repoSlug}`);
  if (repoRes.statusCode !== 200) return null;
  const { default_branch: branch } = JSON.parse(repoRes.body);

  const treeRes = await httpsGet(`https://api.github.com/repos/${repoSlug}/git/trees/${branch}?recursive=1`);
  if (treeRes.statusCode !== 200) return null;
  const { tree } = JSON.parse(treeRes.body);

  const tocs = tree.filter(f => f.type === 'blob' && f.path.endsWith('.toc'));
  if (tocs.length === 0) return null;

  // Priority order for picking the right .toc:
  // 1. Exact match: the .toc file whose basename (without extension) equals addonName
  //    (handles collection repos like ElvUI where ElvUI_AddOnSkins/ElvUI_AddOnSkins.toc is the right one)
  // 2. .toc file inside a directory named addonName
  // 3. .toc file matching the repo name (original single-addon behaviour)
  // 4. First .toc found
  const repoName = repoSlug.split('/')[1];
  const needle = (addonName || repoName).toLowerCase();
  const best =
    tocs.find(f => path.basename(f.path, '.toc').toLowerCase() === needle) ||
    tocs.find(f => f.path.toLowerCase().startsWith(needle + '/')) ||
    tocs.find(f => path.basename(f.path, '.toc').toLowerCase() === repoName.toLowerCase()) ||
    tocs[0];

  const raw = await httpsGet(`https://raw.githubusercontent.com/${repoSlug}/${branch}/${best.path}`);
  if (raw.statusCode !== 200) return null;

  for (const line of raw.body.split('\n')) {
    const m = line.match(/^##\s*Version\s*:\s*(.+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

// Get latest GitHub release or default branch zip URL
async function getLatestGitHubInfo(repoSlug) {
  // Try releases API first
  try {
    const res = await httpsGet(`https://api.github.com/repos/${repoSlug}/releases/latest`);
    if (res.statusCode === 200) {
      const data = JSON.parse(res.body);
      const zipAsset = data.assets?.find(a => a.name.endsWith('.zip'));
      // Also try to get TOC version for a meaningful version string
      const tocVersion = await getRemoteTocVersion(repoSlug).catch(() => null);
      return {
        version: tocVersion || data.tag_name,
        downloadUrl: zipAsset?.browser_download_url || data.zipball_url,
        type: 'release',
      };
    }
  } catch (e) {}

  // Fall back to default branch
  try {
    const repoRes = await httpsGet(`https://api.github.com/repos/${repoSlug}`);
    if (repoRes.statusCode === 200) {
      const repoData = JSON.parse(repoRes.body);
      const branch = repoData.default_branch || 'main';
      const tocVersion = await getRemoteTocVersion(repoSlug).catch(() => null);
      return {
        version: tocVersion || branch,
        downloadUrl: `https://github.com/${repoSlug}/archive/refs/heads/${branch}.zip`,
        type: 'branch',
        branch,
      };
    }
  } catch (e) {}

  throw new Error(`Could not fetch GitHub info for ${repoSlug}`);
}

// Update a single addon — prefers git pull when the folder is a git repo
async function updateAddon(addonsPath, addon, onProgress) {
  const { repoSlug, name, isGitRepo } = addon;
  const dir = path.join(addonsPath, name);

  // ── Git pull path ──────────────────────────────────────────────────
  if (isGitRepo) {
    onProgress('Running git pull…');
    try {
      await execFileAsync('git', ['-C', dir, 'pull', '--ff-only'], { timeout: 30000 });
      onProgress('Getting new version…');
      const { stdout: sha } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
      return { version: sha.trim(), foldersUpdated: [name], method: 'git' };
    } catch (e) {
      throw new Error(`git pull failed: ${e.stderr || e.message}`);
    }
  }

  // ── Zip download path ──────────────────────────────────────────────
  if (!repoSlug) throw new Error('No GitHub repository configured');

  onProgress(`Fetching latest info for ${name}...`);
  const info = await getLatestGitHubInfo(repoSlug);

  onProgress(`Downloading ${info.downloadUrl}...`);
  const { buffer, statusCode } = await downloadBinary(info.downloadUrl);
  if (statusCode !== 200) throw new Error(`Download failed: HTTP ${statusCode}`);

  onProgress('Extracting...');
  const tmpDir = path.join(os.tmpdir(), `addon-update-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const zip = new AdmZip(buffer);
  zip.extractAllTo(tmpDir, true);

  // Locate all addon folders by finding .toc files anywhere in the extracted tree.
  // The parent directory of each .toc file is an addon folder; the .toc filename
  // (minus extension) is the canonical WoW addon folder name to install into.
  const addonFolders = findAddonFoldersViaToc(tmpDir);

  if (addonFolders.length === 0) {
    throw new Error('Could not find addon folders in downloaded zip');
  }

  onProgress('Installing...');
  
  // Replace the addon folder(s)
  for (const folder of addonFolders) {
    const targetPath = path.join(addonsPath, folder.name);
    // Backup old folder
    if (fs.existsSync(targetPath)) {
      const backupPath = targetPath + '.bak';
      if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true });
      fs.renameSync(targetPath, backupPath);
    }
    fs.cpSync(folder.path, targetPath, { recursive: true });
    // Remove backup after success
    const backupPath = targetPath + '.bak';
    if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true });
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });

  // Read the TOC version from the newly installed primary folder
  let installedVersion = info.version;
  try {
    const primaryDir = path.join(addonsPath, addonFolders[0].name);
    const tocs = fs.readdirSync(primaryDir).filter(f => f.endsWith('.toc'));
    for (const toc of tocs) {
      const meta = parseToc(path.join(primaryDir, toc));
      if (meta['version']) { installedVersion = meta['version']; break; }
    }
  } catch (e) {}

  return { version: installedVersion, foldersUpdated: addonFolders.map(f => f.name), method: 'zip' };
}

// --- IPC Handlers ---
ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_, config) => { saveConfig(config); return true; });

ipcMain.handle('addons:scan', (_, addonsPath) => {
  try { return { success: true, addons: scanAddons(addonsPath) }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('addons:setSource', (_, { addonsPath, addonName, source }) => {
  const config = loadConfig();
  if (!config.addonSources) config.addonSources = {};
  if (source) {
    config.addonSources[addonName] = source;
  } else {
    delete config.addonSources[addonName];
  }
  if (addonsPath) config.addonsPath = addonsPath;
  saveConfig(config);
  return { success: true };
});

ipcMain.handle('addons:setPinned', (_, { addonName, pinned }) => {
  const config = loadConfig();
  if (!config.pinnedAddons) config.pinnedAddons = [];
  if (pinned) {
    if (!config.pinnedAddons.includes(addonName)) config.pinnedAddons.push(addonName);
  } else {
    config.pinnedAddons = config.pinnedAddons.filter(n => n !== addonName);
  }
  saveConfig(config);
  return { success: true };
});

ipcMain.handle('addons:checkUpdate', async (_, { repoSlug, addonPath, addonName, isGitRepo }) => {
  try {
    // Git repo: compare local HEAD SHA vs remote HEAD SHA
    if (isGitRepo && addonPath) {
      const { stdout: localSha } = await execFileAsync('git', ['-C', addonPath, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
      const { stdout: remoteRaw } = await execFileAsync('git', ['-C', addonPath, 'ls-remote', 'origin', 'HEAD'], { encoding: 'utf8' });
      const remoteSha = remoteRaw.split('\t')[0]?.slice(0, 7) || null;
      return { success: true, version: remoteSha || localSha.trim(), type: 'git' };
    }
    // Non-git: compare TOC Version fields — pass addonName so collection repos resolve correctly
    const remoteVersion = await getRemoteTocVersion(repoSlug, addonName);
    if (remoteVersion) return { success: true, version: remoteVersion, type: 'toc' };
    // Last resort: fall back to full info (release tag or branch SHA)
    const info = await getLatestGitHubInfo(repoSlug);
    return { success: true, ...info };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('addons:update', async (event, { addonsPath, addon }) => {
  try {
    const result = await updateAddon(addonsPath, addon, (msg) => {
      event.sender.send('update:progress', { addonName: addon.name, message: msg });
    });
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Install a brand-new addon from a GitHub repo slug into the addons folder
ipcMain.handle('addons:install', async (event, { addonsPath, repoSlug }) => {
  const INSTALL_SENTINEL = '__installing__';
  try {
    event.sender.send('install:progress', { message: `Fetching info for ${repoSlug}...` });
    const info = await getLatestGitHubInfo(repoSlug);

    event.sender.send('install:progress', { message: `Downloading ${info.downloadUrl}...` });
    const { buffer, statusCode } = await downloadBinary(info.downloadUrl);
    if (statusCode !== 200) throw new Error(`Download failed: HTTP ${statusCode}`);

    event.sender.send('install:progress', { message: 'Extracting...' });
    const tmpDir = path.join(os.tmpdir(), `addon-install-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const zip = new AdmZip(buffer);
    zip.extractAllTo(tmpDir, true);

    // Locate all addon folders by finding .toc files anywhere in the extracted tree.
    const addonFolders = findAddonFoldersViaToc(tmpDir);

    if (addonFolders.length === 0) throw new Error('No addon folders found in downloaded zip');

    event.sender.send('install:progress', { message: `Installing ${addonFolders.length} folder(s)...` });
    for (const folder of addonFolders) {
      const targetPath = path.join(addonsPath, folder.name);
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true });
      fs.cpSync(folder.path, targetPath, { recursive: true });
    }
    fs.rmSync(tmpDir, { recursive: true });

    // Save source to config for ALL installed folders so each sub-addon of a
    // collection repo (e.g. ElvUI_AddOnSkins, ElvUI_Enhanced, …) gets tracked.
    const config = loadConfig();
    if (!config.addonSources) config.addonSources = {};
    for (const folder of addonFolders) {
      config.addonSources[folder.name] = `https://github.com/${repoSlug}`;
    }
    saveConfig(config);

    return { success: true, version: info.version, foldersInstalled: addonFolders.map(f => f.name) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('addons:remove', (_, { addonsPath, addonName }) => {
  try {
    const addonPath = path.join(addonsPath, addonName);
    if (!fs.existsSync(addonPath)) return { success: false, error: 'Addon folder not found' };
    fs.rmSync(addonPath, { recursive: true, force: true });
    // Remove from config sources and pinned list
    const config = loadConfig();
    if (config.addonSources) delete config.addonSources[addonName];
    if (config.pinnedAddons) config.pinnedAddons = config.pinnedAddons.filter(n => n !== addonName);
    saveConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:openFolder', (_, folderPath) => {
  const env = {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':0',
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${process.getuid()}/bus`,
  };
  if (process.platform === 'linux') {
    execFile('xdg-open', [folderPath], { env });
  } else if (process.platform === 'darwin') {
    execFile('open', [folderPath]);
  } else {
    execFile('explorer', [folderPath]);
  }
});

ipcMain.handle('shell:openUrl', (_, url) => {
  shell.openExternal(url);
});

// --- App window ---
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: 'AddonKeeper',
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
