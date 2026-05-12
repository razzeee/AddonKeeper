import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderOpen, Pencil, Pin, PinOff, RefreshCw,
  Download, Plus, Search, FolderInput, ArrowRight,
  CheckCircle2, AlertCircle, Clock, Loader2, Package,
  X, Boxes, GitBranch, Trash2, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';

type SortCol = 'name' | 'version' | 'source' | 'status';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<string, number> = {
  'update-available': 0,
  'error':            1,
  'checking':         2,
  'updating':         3,
  'up-to-date':       4,
  'idle':             5,
};

// Lucide doesn't ship a GitHub mark — use the official SVG inline
function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}
import type { Addon, Config } from './types';
import './App.css';

const api = window.electronAPI;

function parseRepoSlug(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/github\.com[/:]([^/\s]+\/[^/\s#?]+)/);
  if (urlMatch) return urlMatch[1].replace(/\.git$/, '');
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
  return null;
}

function StatusBadge({ status, pinned }: { status: Addon['status']; pinned: boolean }) {
  if (pinned) return (
    <span className="badge badge-pinned">
      <Pin size={10} strokeWidth={2.5} /> Pinned
    </span>
  );
  const map: Record<Addon['status'], { label: string; cls: string; icon: React.ReactNode }> = {
    idle:               { label: 'Idle',             cls: 'badge-idle',    icon: <Clock size={10} /> },
    checking:           { label: 'Checking',         cls: 'badge-checking',icon: <Loader2 size={10} className="spin" /> },
    'up-to-date':       { label: 'Up to date',       cls: 'badge-ok',      icon: <CheckCircle2 size={10} /> },
    'update-available': { label: 'Update available', cls: 'badge-update',  icon: <Download size={10} /> },
    updating:           { label: 'Updating',         cls: 'badge-checking',icon: <Loader2 size={10} className="spin" /> },
    error:              { label: 'Error',             cls: 'badge-error',   icon: <AlertCircle size={10} /> },
  };
  const { label, cls, icon } = map[status];
  return <span className={`badge ${cls}`}>{icon}{label}</span>;
}

function SourceModal({ addon, onSave, onClose }: {
  addon: Addon; onSave: (source: string) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(addon.source || '');
  const slug = parseRepoSlug(value);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <GithubIcon size={18} />
          <h3>Set source — <span className="modal-addon-name">{addon.name}</span></h3>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-hint">Paste a GitHub URL or <code>owner/repo</code> slug.</p>
        <input
          className="modal-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="https://github.com/owner/repo"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && slug) { onSave(value.trim()); onClose(); } }}
        />
        {slug && (
          <div className="repo-preview">
            <GithubIcon size={13} />
            <span>{slug}</span>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!slug} onClick={() => { onSave(value.trim()); onClose(); }}>
            Save source
          </button>
        </div>
      </div>
    </div>
  );
}

function AddAddonModal({ onInstall, onClose }: {
  onInstall: (repoSlug: string) => Promise<{ success: boolean; error?: string } | undefined>;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slug = parseRepoSlug(value);

  useEffect(() => {
    const cleanup = api.onInstallProgress(({ message }) => setProgress(message));
    return cleanup;
  }, []);

  const handleInstall = async () => {
    if (!slug) return;
    setError(null);
    const res = await onInstall(slug);
    if (res && !res.success) setError(res.error || 'Installation failed');
  };

  return (
    <div className="modal-overlay" onClick={!progress ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Plus size={18} />
          <h3>Add new addon</h3>
          {!progress && <button className="modal-close" onClick={onClose}><X size={16} /></button>}
        </div>
        <p className="modal-hint">
          Paste a GitHub URL or <code>owner/repo</code> slug. The addon will be downloaded and installed immediately.
        </p>
        <input
          className="modal-input"
          value={value}
          onChange={e => { setValue(e.target.value); setError(null); setProgress(null); }}
          placeholder="https://github.com/owner/repo"
          autoFocus
          disabled={!!progress}
          onKeyDown={e => { if (e.key === 'Enter' && slug && !progress) handleInstall(); }}
        />
        {slug && !progress && (
          <div className="repo-preview">
            <GithubIcon size={13} />
            <span>{slug}</span>
          </div>
        )}
        {progress && (
          <div className="install-progress">
            <Loader2 size={13} className="spin" />
            {progress}
          </div>
        )}
        {error && (
          <div className="install-error">
            <AlertCircle size={13} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={!!progress}>Cancel</button>
          <button className="btn btn-primary" disabled={!slug || !!progress} onClick={handleInstall}>
            {progress ? <><Loader2 size={14} className="spin" /> Installing…</> : <><Download size={14} /> Install</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: SortDir }) {
  if (col !== sortCol) return <ChevronsUpDown size={11} className="sort-icon sort-icon-idle" />;
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="sort-icon sort-icon-active" />
    : <ChevronDown size={11} className="sort-icon sort-icon-active" />;
}

export default function App() {
  const [config, setConfig] = useState<Config>({ addonsPath: '', addonSources: {}, pinnedAddons: [] });
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showUpdatesOnly, setShowUpdatesOnly] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingAddon, setEditingAddon] = useState<Addon | null>(null);
  const [addingAddon, setAddingAddon] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    api.loadConfig().then(cfg => {
      setConfig(cfg);
      if (cfg.addonsPath) doScan(cfg.addonsPath);
    });
    const cleanup = api.onUpdateProgress(({ addonName, message }) => {
      setAddons(prev => prev.map(a => a.name === addonName ? { ...a, progressMessage: message } : a));
    });
    cleanupRef.current = cleanup;
    return () => { if (cleanupRef.current) cleanupRef.current(); };
  }, []);

  const doScan = useCallback(async (addonsPath: string) => {
    setLoading(true);
    setScanError(null);
    const res = await api.scanAddons(addonsPath);
    setLoading(false);
    if (res.success) { setAddons(res.addons); setSelected(new Set()); }
    else setScanError(res.error || 'Unknown error');
  }, []);

  const selectFolder = async () => {
    const folder = await api.selectFolder();
    if (folder) {
      const newConfig = { ...config, addonsPath: folder };
      setConfig(newConfig);
      await api.saveConfig(newConfig);
      doScan(folder);
    }
  };

  const updateAddonStatus = (name: string, patch: Partial<Addon>) =>
    setAddons(prev => prev.map(a => a.name === name ? { ...a, ...patch } : a));

  const checkAddon = async (addon: Addon) => {
    if ((!addon.repoSlug && !addon.isGitRepo) || addon.pinned) return;
    updateAddonStatus(addon.name, { status: 'checking', errorMessage: undefined });
    const res = await api.checkUpdate({
      repoSlug: addon.repoSlug ?? undefined,
      addonName: addon.name,
      addonPath: `${config.addonsPath}/${addon.name}`,
      isGitRepo: addon.isGitRepo,
    });
    if (res.success) {
      updateAddonStatus(addon.name, {
        status: res.version !== addon.version ? 'update-available' : 'up-to-date',
        latestVersion: res.version,
      });
    } else {
      updateAddonStatus(addon.name, { status: 'error', errorMessage: res.error });
    }
  };

  const updateAddon = async (addon: Addon) => {
    if ((!addon.repoSlug && !addon.isGitRepo) || !config.addonsPath || addon.pinned) return;
    updateAddonStatus(addon.name, { status: 'updating', errorMessage: undefined, progressMessage: 'Starting…' });
    const res = await api.updateAddon({ addonsPath: config.addonsPath, addon });
    if (res.success) {
      updateAddonStatus(addon.name, {
        status: 'up-to-date', version: res.version || addon.version,
        latestVersion: res.version, progressMessage: undefined,
        foldersUpdated: res.foldersUpdated, updateMethod: res.method as 'git' | 'zip' | undefined,
      });
    } else {
      updateAddonStatus(addon.name, { status: 'error', errorMessage: res.error, progressMessage: undefined });
    }
  };

  const removeAddon = async (addon: Addon) => {
    if (!config.addonsPath) return;
    const confirmed = window.confirm(`Remove "${addon.name}" and delete its folder? This cannot be undone.`);
    if (!confirmed) return;
    const res = await api.removeAddon({ addonsPath: config.addonsPath, addonName: addon.name });
    if (res.success) {
      setAddons(prev => prev.filter(a => a.name !== addon.name));
      setSelected(prev => { const next = new Set(prev); next.delete(addon.name); return next; });
    } else {
      alert(`Failed to remove addon: ${res.error}`);
    }
  };

  const checkAll = async () => {
    const targets = addons.filter(a => (a.repoSlug || a.isGitRepo) && !a.pinned && (selected.size > 0 ? selected.has(a.name) : true));
    for (const addon of targets) await checkAddon(addon);
  };

  const updateAll = async () => {
    const targets = addons.filter(a => (a.repoSlug || a.isGitRepo) && !a.pinned && (selected.size > 0 ? selected.has(a.name) : a.status === 'update-available'));
    for (const addon of targets) await updateAddon(addon);
  };

  const installAddon = async (repoSlug: string) => {
    if (!config.addonsPath) return;
    const res = await api.installAddon({ addonsPath: config.addonsPath, repoSlug });
    if (res.success) { setAddingAddon(false); doScan(config.addonsPath); }
    return res;
  };

  const togglePin = async (addon: Addon) => {
    const pinned = !addon.pinned;
    await api.setPinned({ addonName: addon.name, pinned });
    updateAddonStatus(addon.name, { pinned, status: pinned ? 'idle' : addon.status });
  };

  const setSource = async (addon: Addon, source: string) => {
    let slug = source;
    const m = source.match(/github\.com[/:]([^/\s]+\/[^/\s#?]+)/);
    if (m) slug = m[1].replace(/\.git$/, '');
    const normalizedSource = slug.includes('/') && !slug.includes('github.com')
      ? `https://github.com/${slug}` : source;
    await api.setAddonSource({ addonsPath: config.addonsPath, addonName: addon.name, source: normalizedSource });
    updateAddonStatus(addon.name, {
      source: normalizedSource, repoSlug: slug.includes('/') ? slug : null,
      hasSource: true, status: 'idle',
    });
  };

  const toggleSelect = (name: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  };

  const toggleAll = () => {
    if (selectAll) { setSelected(new Set()); setSelectAll(false); }
    else { setSelected(new Set(filtered.map(a => a.name))); setSelectAll(true); }
  };

  const handleSort = (col: SortCol) => {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const filtered = addons
    .filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
    .filter(a => !showUpdatesOnly || a.status === 'update-available')
    .sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'name')    cmp = a.name.localeCompare(b.name);
      if (sortCol === 'version') cmp = (a.version || '').localeCompare(b.version || '');
      if (sortCol === 'source')  cmp = (a.repoSlug || a.source || '').localeCompare(b.repoSlug || b.source || '');
      if (sortCol === 'status')  cmp = (STATUS_ORDER[a.pinned ? 'idle' : a.status] ?? 9) - (STATUS_ORDER[b.pinned ? 'idle' : b.status] ?? 9);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  const withSource = addons.filter(a => a.repoSlug).length;
  const updateAvailable = addons.filter(a => a.status === 'update-available').length;
  const pinned = addons.filter(a => a.pinned).length;

  return (
    <div className="app">
      {/* ── Header ─────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="app-logo">
            <Boxes size={20} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="app-title">AddonKeeper</h1>
            {config.addonsPath && (
              <button
                className="path-pill"
                onClick={() => api.openFolder(config.addonsPath)}
                title="Open in file manager"
              >
                <FolderOpen size={11} />
                <span>{config.addonsPath}</span>
              </button>
            )}
          </div>
        </div>
        <button className="btn btn-outline" onClick={selectFolder}>
          <FolderInput size={14} />
          {config.addonsPath ? 'Change folder' : 'Select AddOns folder'}
        </button>
      </header>

      {/* ── Toolbar ────────────────────────────────── */}
      {config.addonsPath && (
        <div className="toolbar">
          <div className="search-wrap">
            <Search size={13} className="search-icon" />
            <input
              className="search"
              placeholder="Filter addons…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>

          <button
            className={`btn btn-filter ${showUpdatesOnly ? 'btn-filter-active' : ''}`}
            onClick={() => setShowUpdatesOnly(v => !v)}
            title="Show only addons with updates available"
          >
            <Download size={13} />
            Updates only
          </button>

          <div className="toolbar-stats">
            <span className="stat"><Package size={12} />{addons.length} addons</span>
            {withSource > 0 && <span className="stat"><GithubIcon size={12} />{withSource} tracked</span>}
            {updateAvailable > 0 && <span className="stat stat-update"><Download size={12} />{updateAvailable} updates</span>}
            {pinned > 0 && <span className="stat stat-pinned"><Pin size={12} />{pinned} pinned</span>}
          </div>

          <div className="toolbar-actions">
            <button className="btn btn-ghost" onClick={checkAll} disabled={loading}>
              <RefreshCw size={14} />
              Check {selected.size > 0 ? `${selected.size} selected` : 'all'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={updateAll}
              disabled={loading || (selected.size === 0 && updateAvailable === 0)}
            >
              <Download size={14} />
              Update {selected.size > 0 ? `${selected.size} selected` : updateAvailable > 0 ? updateAvailable : 'all'}
            </button>
            <button className="btn btn-ghost" onClick={() => api.openFolder(config.addonsPath)} title="Open AddOns folder in file manager">
              <FolderOpen size={14} />
              Open folder
            </button>
            <button className="btn btn-primary" onClick={() => setAddingAddon(true)}>
              <Plus size={14} />
              Add addon
            </button>
          </div>
        </div>
      )}

      {/* ── Errors ─────────────────────────────────── */}
      {scanError && (
        <div className="error-banner">
          <AlertCircle size={14} /> {scanError}
        </div>
      )}

      {/* ── Empty / loading states ──────────────────── */}
      {loading && addons.length === 0 && (
        <div className="empty-state">
          <Loader2 size={32} className="spin" strokeWidth={1.5} />
          <p>Scanning addons…</p>
        </div>
      )}

      {!config.addonsPath && (
        <div className="empty-state">
          <FolderOpen size={48} strokeWidth={1} className="empty-icon" />
          <p className="empty-title">No folder selected</p>
          <p className="empty-sub">Point the app at your Ascension AddOns directory to get started.</p>
          <button className="btn btn-primary" onClick={selectFolder}>
            <FolderInput size={14} /> Select AddOns folder
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────── */}
      {addons.length > 0 && (
        <div className="table-wrapper">
          <table className="addon-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input type="checkbox" checked={selectAll} onChange={toggleAll} />
                </th>
                <th className="col-name">
                  <button className="sort-btn" onClick={() => handleSort('name')}>
                    Addon <SortIcon col="name" sortCol={sortCol} sortDir={sortDir} />
                  </button>
                </th>
                <th className="col-version">
                  <button className="sort-btn" onClick={() => handleSort('version')}>
                    Version <SortIcon col="version" sortCol={sortCol} sortDir={sortDir} />
                  </button>
                </th>
                <th className="col-source">
                  <button className="sort-btn" onClick={() => handleSort('source')}>
                    Source <SortIcon col="source" sortCol={sortCol} sortDir={sortDir} />
                  </button>
                </th>
                <th className="col-status">
                  <button className="sort-btn" onClick={() => handleSort('status')}>
                    Status <SortIcon col="status" sortCol={sortCol} sortDir={sortDir} />
                  </button>
                </th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(addon => (
                <tr
                  key={addon.name}
                  className={[
                    selected.has(addon.name) ? 'row-selected' : '',
                    addon.pinned ? 'row-pinned' : '',
                  ].join(' ')}
                >
                  <td className="col-check">
                    <input type="checkbox" checked={selected.has(addon.name)} onChange={() => toggleSelect(addon.name)} />
                  </td>

                  <td className="col-name">
                    <span className="addon-name">{addon.name}</span>
                    {addon.progressMessage && addon.status === 'updating' && (
                      <div className="progress-msg">
                        <Loader2 size={10} className="spin" /> {addon.progressMessage}
                      </div>
                    )}
                    {addon.errorMessage && (
                      <div className="error-msg" title={addon.errorMessage}>
                        <AlertCircle size={10} /> {addon.errorMessage}
                      </div>
                    )}
                  </td>

                  <td className="col-version">
                    <span className="version-text">{addon.version || '—'}</span>
                    {addon.latestVersion && addon.latestVersion !== addon.version && (
                      <span className="version-arrow">
                        <ArrowRight size={10} /><span className="version-new">{addon.latestVersion}</span>
                      </span>
                    )}
                  </td>

                  <td className="col-source">
                    {addon.isGitRepo && (
                      <span className="git-badge" title="This folder is a git repository — updates use git pull">
                        <GitBranch size={10} /> git
                      </span>
                    )}
                    {addon.source ? (
                      <button
                        className="source-link"
                        onClick={() => api.openUrl(addon.source!)}
                        title={addon.source}
                      >
                        <GithubIcon size={12} />
                        <span>{addon.repoSlug || addon.source}</span>
                      </button>
                    ) : !addon.isGitRepo ? (
                      <span className="no-source">No source</span>
                    ) : null}
                  </td>

                  <td className="col-status">
                    <StatusBadge status={addon.status} pinned={addon.pinned} />
                  </td>

                  <td className="col-actions">
                    <div className="action-group">
                      <button
                        className="icon-btn"
                        title="Open addon folder"
                        onClick={() => api.openFolder(`${config.addonsPath}/${addon.name}`)}
                      >
                        <FolderOpen size={15} />
                      </button>
                      <button
                        className="icon-btn icon-btn-danger"
                        title="Remove addon (deletes folder)"
                        onClick={() => removeAddon(addon)}
                      >
                        <Trash2 size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Set / change source"
                        onClick={() => setEditingAddon(addon)}
                      >
                        <Pencil size={15} />
                      </button>
                      {(addon.repoSlug || addon.isGitRepo) && (
                        <>
                          <button
                            className={`icon-btn ${addon.pinned ? 'icon-btn-active' : ''}`}
                            title={addon.pinned ? 'Unpin — allow updates' : 'Pin — prevent updates'}
                            onClick={() => togglePin(addon)}
                          >
                            {addon.pinned ? <Pin size={15} /> : <PinOff size={15} />}
                          </button>
                          <div className="action-divider" />
                          <button
                            className="icon-btn"
                            title="Check for update"
                            disabled={addon.pinned || addon.status === 'checking' || addon.status === 'updating'}
                            onClick={() => checkAddon(addon)}
                          >
                            {addon.status === 'checking'
                              ? <Loader2 size={15} className="spin" />
                              : <RefreshCw size={15} />}
                          </button>
                          <button
                            className="icon-btn icon-btn-download"
                            title={addon.pinned ? 'Pinned — updates blocked' : 'Update now'}
                            disabled={addon.pinned || addon.status === 'updating'}
                            onClick={() => updateAddon(addon)}
                          >
                            {addon.status === 'updating'
                              ? <Loader2 size={15} className="spin" />
                              : <Download size={15} />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────── */}
      {editingAddon && (
        <SourceModal
          addon={editingAddon}
          onSave={source => setSource(editingAddon, source)}
          onClose={() => setEditingAddon(null)}
        />
      )}
      {addingAddon && (
        <AddAddonModal
          onInstall={installAddon}
          onClose={() => setAddingAddon(false)}
        />
      )}
    </div>
  );
}
