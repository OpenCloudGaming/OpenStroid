import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Gauge,
  HardDrive,
  LogOut,
  Monitor,
  Plug,
  RefreshCcw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Users,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import { AuthCaptureDebugPanel } from '../components/AuthCaptureDebugPanel';
import { useAuth } from '../auth';
import {
  DEFAULT_SETTINGS,
  readAppSettings,
  resetAppSettings,
  saveAppSettings,
  type AppSettings,
  type StreamDefaults,
} from '../lib/userSettings';
import {
  MAX_STREAM_BITRATE_MBPS,
  MIN_STREAM_BITRATE_MBPS,
  STREAM_ENCODING_OPTIONS,
  STREAM_QUALITY_OPTIONS,
  STREAM_RESOLUTION_OPTIONS,
} from '../stream/streamOptions';

const EXTENSION_PATH = 'C:\\Users\\Zortos\\Projects\\OpenStroid\\extension\\openstroid-capture';

type SettingsSectionId = 'account' | 'bridge' | 'stream' | 'diagnostics';

const SETTINGS_NAV_GROUPS: Array<{
  label: string;
  items: Array<{
    id: SettingsSectionId;
    label: string;
    icon: ReactNode;
    keywords: string[];
  }>;
}> = [
  {
    label: 'Account',
    items: [
      { id: 'account', label: 'Account', icon: <Users size={15} />, keywords: ['session', 'sign', 'profile', 'email'] },
    ],
  },
  {
    label: 'Streaming',
    items: [
      { id: 'stream', label: 'Stream', icon: <Wifi size={15} />, keywords: ['quality', 'resolution', 'encoding', 'codec', 'av1', 'h264', 'fps', 'bitrate', 'volume', 'audio', 'fsr', 'microphone', 'stats'] },
    ],
  },
  {
    label: 'App',
    items: [
      { id: 'bridge', label: 'Bridge', icon: <Plug size={15} />, keywords: ['extension', 'url', 'health', 'chrome'] },
      { id: 'diagnostics', label: 'Diagnostics', icon: <AlertCircle size={15} />, keywords: ['debug', 'capture', 'logs'] },
    ],
  },
];

function updateStreamSettings(settings: AppSettings, patch: Partial<StreamDefaults>): AppSettings {
  return {
    ...settings,
    stream: {
      ...settings.stream,
      ...patch,
    },
  };
}

function bridgeBadgeClass(status: 'checking' | 'online' | 'offline'): string {
  if (status === 'online') return 'settings-inline-badge settings-inline-badge--online';
  if (status === 'offline') return 'settings-inline-badge settings-inline-badge--offline';
  return 'settings-inline-badge settings-inline-badge--checking';
}

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { user, logout, refreshSession, isLoading } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(() => readAppSettings());
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('stream');
  const [settingsSearch, setSettingsSearch] = useState('');

  const checkBridge = useCallback(async () => {
    setBridgeStatus('checking');
    try {
      const response = await fetch('/health');
      const payload = await response.json().catch(() => null);
      setBridgeStatus(response.ok && payload?.desktopBridge ? 'online' : 'offline');
    } catch {
      setBridgeStatus('offline');
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void checkBridge();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [checkBridge]);

  const flashSaved = useCallback((message?: string) => {
    if (message) setStatusMessage(message);
    setSavedIndicator(true);
    window.setTimeout(() => {
      setSavedIndicator(false);
      setStatusMessage('');
    }, 1500);
  }, []);

  const updateStream = useCallback((patch: Partial<StreamDefaults>) => {
    setSettings((current) => {
      const next = updateStreamSettings(current, patch);
      saveAppSettings(next);
      return next;
    });
    flashSaved('Saved');
  }, [flashSaved]);

  const reset = useCallback(() => {
    const defaults = resetAppSettings();
    setSettings(defaults);
    flashSaved('Defaults restored');
  }, [flashSaved]);

  const copyExtensionPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(EXTENSION_PATH);
      flashSaved('Path copied');
    } catch {
      flashSaved('Copy failed');
    }
  }, [flashSaved]);

  const navigateSettings = useCallback((section: SettingsSectionId) => {
    setActiveSection(section);
    setSettingsSearch('');
    document.querySelector('.settings-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const searchQuery = settingsSearch.trim().toLowerCase();
  const showAll = searchQuery.length > 0;

  const filteredGroups = useMemo(() => {
    if (!showAll) return SETTINGS_NAV_GROUPS;
    return SETTINGS_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.label.toLowerCase().includes(searchQuery)
        || item.keywords.some((keyword) => keyword.includes(searchQuery)),
      ),
    })).filter((group) => group.items.length > 0);
  }, [searchQuery, showAll]);

  const sectionVisible = useCallback((section: SettingsSectionId) => {
    if (!showAll) return activeSection === section;
    const navItem = SETTINGS_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.id === section);
    if (!navItem) return false;
    return navItem.label.toLowerCase().includes(searchQuery)
      || navItem.keywords.some((keyword) => keyword.includes(searchQuery));
  }, [activeSection, searchQuery, showAll]);

  const hasVisibleSections =
    sectionVisible('stream')
    || sectionVisible('account')
    || sectionVisible('bridge')
    || sectionVisible('diagnostics');

  return (
    <>
      <header className="settings-modal-header">
        <h1>Settings</h1>
        <div className="settings-modal-header-actions">
          <div className={`settings-saved ${savedIndicator ? 'visible' : ''}`}>
            <Check size={14} />
            {statusMessage || 'Saved'}
          </div>
          <button
            type="button"
            className="settings-modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-sidebar" aria-label="Settings sections">
          <div className="settings-search-wrap">
            <Search size={13} className="settings-search-icon" />
            <input
              type="text"
              className="settings-search-input"
              placeholder="Search settings..."
              aria-label="Search settings"
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.currentTarget.value)}
            />
            {settingsSearch && (
                <button type="button" className="settings-search-clear" aria-label="Clear search" onClick={() => setSettingsSearch('')}>
                  <X size={11} />
                </button>
            )}
          </div>

          <div className="settings-nav">
            {filteredGroups.map((group) => (
              <div key={group.label} className="settings-nav-group">
                <div className="settings-nav-group-label">{group.label}</div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav-item ${!showAll && activeSection === item.id ? 'active' : ''}`}
                      onClick={() => navigateSettings(item.id)}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </nav>

        <div className="settings-content">
          {!hasVisibleSections ? (
            <section className="settings-section">
              <div className="settings-thanks-state settings-thanks-state--muted">
                No settings match &ldquo;{settingsSearch.trim()}&rdquo;
              </div>
            </section>
          ) : (
            <>
              {sectionVisible('stream') && (
                <SettingSection id="stream" title="Stream defaults" icon={<Monitor size={18} />}>
                  <div className="settings-rows">
                    <div className="settings-row settings-row--column">
                      <label className="settings-label settings-label--with-icon">
                        <SlidersHorizontal size={15} className="settings-label-icon" />
                        Quality preset
                      </label>
                      <div className="settings-chip-row">
                        {STREAM_QUALITY_OPTIONS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            className={`settings-chip ${settings.stream.quality === preset.value ? 'active' : ''}`}
                            onClick={() => updateStream({ quality: preset.value })}
                          >
                            <span>{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="settings-row settings-row--column">
                      <label className="settings-label settings-label--with-icon">
                        <Monitor size={15} className="settings-label-icon" />
                        Resolution
                      </label>
                      <div className="settings-chip-row">
                        {STREAM_RESOLUTION_OPTIONS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            className={`settings-chip ${settings.stream.resolution === preset.value ? 'active' : ''}`}
                            onClick={() => updateStream({ resolution: preset.value })}
                          >
                            <span>{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="settings-row settings-row--column">
                      <label className="settings-label settings-label--with-icon">
                        <Wifi size={15} className="settings-label-icon" />
                        Encoding
                      </label>
                      <div className="settings-chip-row">
                        {STREAM_ENCODING_OPTIONS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            className={`settings-chip ${settings.stream.encoding === preset.value ? 'active' : ''}`}
                            onClick={() => updateStream({ encoding: preset.value })}
                          >
                            <span>{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="settings-row">
                      <label className="settings-label settings-label--with-icon">
                        <Gauge size={15} className="settings-label-icon" />
                        Frame rate
                      </label>
                      <div className="settings-chip-row">
                        {[60, 120].map((fps) => (
                          <button
                            key={fps}
                            type="button"
                            className={`settings-chip ${settings.stream.maxFps === fps ? 'active' : ''}`}
                            onClick={() => updateStream({ maxFps: fps })}
                          >
                            <span>{fps} FPS</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="settings-row settings-row--column">
                      <div className="settings-row-top">
                        <label className="settings-label settings-label--with-icon">
                          <HardDrive size={15} className="settings-label-icon" />
                          Max bitrate
                        </label>
                        <span className="settings-value-badge">{settings.stream.maxBitrate} Mbps</span>
                      </div>
                      <input
                        type="range"
                        name="maxBitrate"
                        className="settings-slider"
                        min={MIN_STREAM_BITRATE_MBPS}
                        max={MAX_STREAM_BITRATE_MBPS}
                        step={1}
                        value={settings.stream.maxBitrate}
                        aria-label="Max bitrate"
                        onChange={(event) => updateStream({ maxBitrate: Number(event.currentTarget.value) })}
                      />
                    </div>

                    <div className="settings-row settings-row--column">
                      <div className="settings-row-top">
                        <label className="settings-label settings-label--with-icon">
                          <Volume2 size={15} className="settings-label-icon" />
                          Volume
                        </label>
                        <span className="settings-value-badge">
                          {settings.stream.muted ? 'Muted' : `${settings.stream.volume}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        name="volume"
                        className="settings-slider"
                        max={100}
                        step={1}
                        value={settings.stream.volume}
                        aria-label="Volume"
                        onChange={(event) => {
                          const volume = Number(event.currentTarget.value);
                          updateStream({ volume, muted: volume === 0 ? true : settings.stream.muted });
                        }}
                      />
                    </div>
                  </div>

                  <div className="settings-toggle-grid">
                    <StreamToggle
                      label="Mute audio"
                      checked={settings.stream.muted}
                      onChange={(checked) => updateStream({ muted: checked })}
                    />
                    <StreamToggle
                      label="FSR upscaling"
                      checked={settings.stream.fsrEnabled}
                      onChange={(checked) => updateStream({ fsrEnabled: checked })}
                    />
                    <StreamToggle
                      label="Microphone bridge"
                      checked={settings.stream.micEnabled}
                      onChange={(checked) => updateStream({ micEnabled: checked })}
                    />
                    <StreamToggle
                      label="Stats overlay"
                      checked={settings.stream.statsVisible}
                      onChange={(checked) => updateStream({ statsVisible: checked })}
                    />
                  </div>

                  <div className="settings-footer-row">
                    <button type="button" className="settings-export-logs-btn" onClick={reset}>
                      <RotateCcw size={16} />
                      Reset defaults
                    </button>
                    <span className="settings-subtle-hint">Defaults apply to new stream sessions.</span>
                  </div>
                </SettingSection>
              )}

              {sectionVisible('account') && (
                <SettingSection id="account" title="Account" icon={<Users size={18} />}>
                  <div className="settings-rows">
                    <div className="settings-row settings-row--top-aligned">
                      <div>
                        <div className="settings-label">{user?.name || user?.email || 'OpenStroid user'}</div>
                        <span className="settings-hint">{user?.email ?? 'No email in local session.'}</span>
                        <div className="settings-account-badge-row">
                          <span className={user ? 'settings-inline-badge settings-inline-badge--online' : 'settings-inline-badge settings-inline-badge--offline'}>
                            {user ? 'Signed in' : 'Offline'}
                          </span>
                        </div>
                      </div>
                      <div className="settings-account-actions">
                        <button
                          type="button"
                          className="settings-export-logs-btn"
                          disabled={isLoading}
                          onClick={() => void refreshSession()}
                        >
                          <RefreshCcw size={16} />
                          Refresh session
                        </button>
                        <button type="button" className="settings-delete-cache-btn" onClick={() => void logout()}>
                          <LogOut size={16} />
                          Sign out
                        </button>
                      </div>
                    </div>
                  </div>
                </SettingSection>
              )}

              {sectionVisible('bridge') && (
                <SettingSection id="bridge" title="Bridge" icon={<Plug size={18} />}>
                  <div className="settings-rows">
                    <div className="settings-row">
                      <span className="settings-label">Local bridge status</span>
                      <div className="settings-account-actions">
                        <span className={bridgeBadgeClass(bridgeStatus)}>{bridgeStatus}</span>
                        <button type="button" className="settings-export-logs-btn settings-save-btn--compact" onClick={() => void checkBridge()}>
                          <RefreshCcw size={14} />
                          Check bridge
                        </button>
                      </div>
                    </div>

                    <div className="settings-row settings-row--column">
                      <label className="settings-label" htmlFor="bridge-url">Extension bridge URL</label>
                      <input
                        id="bridge-url"
                        name="bridgeUrl"
                        type="text"
                        className="settings-text-input"
                        value={settings.bridgeUrl}
                        onChange={(event) => {
                          setSettings((current) => {
                            const next = { ...current, bridgeUrl: event.currentTarget.value };
                            saveAppSettings(next);
                            return next;
                          });
                          flashSaved('Saved');
                        }}
                      />
                      <span className="settings-hint">
                        Default: <code>{DEFAULT_SETTINGS.bridgeUrl}</code>
                      </span>
                    </div>

                    <div className="settings-row settings-row--column">
                      <label className="settings-label">Chrome extension folder</label>
                      <div className="settings-path-control">
                        <code className="settings-path-value">{EXTENSION_PATH}</code>
                        <button type="button" className="settings-export-logs-btn settings-save-btn--compact" onClick={() => void copyExtensionPath()}>
                          <Copy size={14} />
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>
                </SettingSection>
              )}

              {sectionVisible('diagnostics') && (
                <SettingSection id="diagnostics" title="Diagnostics" icon={<AlertCircle size={18} />}>
                  <AuthCaptureDebugPanel compact variant="settings" title="Latest upstream capture" />
                </SettingSection>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SettingSection({
  id,
  title,
  icon,
  children,
}: {
  id: SettingsSectionId;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={`settings-${id}`} className="settings-section">
      <div className="settings-section-header">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function StreamToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputId = `settings-toggle-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={inputId}>{label}</label>
      <label className="settings-toggle" htmlFor={inputId}>
        <input
          id={inputId}
          name={inputId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="settings-toggle-track" />
      </label>
    </div>
  );
}
