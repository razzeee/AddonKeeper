export interface Addon {
  name: string;
  version: string | null;
  source: string | null;
  repoSlug: string | null;
  hasSource: boolean;
  pinned: boolean;
  isGitRepo: boolean;
  status: 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'updating' | 'error';
  latestVersion?: string;
  updateMethod?: 'git' | 'zip';
  errorMessage?: string;
  progressMessage?: string;
  foldersUpdated?: string[];
}

export interface Config {
  addonsPath: string;
  addonSources: Record<string, string>;
  pinnedAddons: string[];
}

export interface ElectronAPI {
  loadConfig: () => Promise<Config>;
  saveConfig: (config: Partial<Config>) => Promise<boolean>;
  scanAddons: (addonsPath: string) => Promise<{ success: boolean; addons: Addon[]; error?: string }>;
  setAddonSource: (data: { addonsPath?: string; addonName: string; source: string | null }) => Promise<{ success: boolean }>;
  setPinned: (data: { addonName: string; pinned: boolean }) => Promise<{ success: boolean }>;
  checkUpdate: (data: { repoSlug?: string; addonName?: string; addonPath?: string; isGitRepo?: boolean }) => Promise<{ success: boolean; version?: string; error?: string }>;
  updateAddon: (data: { addonsPath: string; addon: Addon }) => Promise<{ success: boolean; version?: string; method?: string; foldersUpdated?: string[]; error?: string }>;
  installAddon: (data: { addonsPath: string; repoSlug: string }) => Promise<{ success: boolean; version?: string; foldersInstalled?: string[]; error?: string }>;
  removeAddon: (data: { addonsPath: string; addonName: string }) => Promise<{ success: boolean; error?: string }>;
  selectFolder: () => Promise<string | null>;
  openFolder: (p: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  onUpdateProgress: (cb: (data: { addonName: string; message: string }) => void) => () => void;
  onInstallProgress: (cb: (data: { message: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
