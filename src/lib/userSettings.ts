import type { StreamQualityPreset } from '../stream/OpenStroidStreamClient';

export const SETTINGS_KEYS = {
  bridgeUrl: 'openstroid:bridgeUrl',
  streamVolume: 'stream_audio_volume',
  streamMuted: 'openstroid:streamMuted',
  streamBitrate: 'bitrateValue',
  streamFps: 'fpsRateValue',
  streamQuality: 'openstroid:streamQuality',
  streamFsr: 'openstroid:streamFsr',
  streamMic: 'openstroid:streamMic',
  streamStats: 'stream_stats_visible',
} as const;

export interface StreamDefaults {
  volume: number;
  muted: boolean;
  maxBitrate: number;
  maxFps: number;
  quality: StreamQualityPreset;
  fsrEnabled: boolean;
  micEnabled: boolean;
  statsVisible: boolean;
}

export interface AppSettings {
  bridgeUrl: string;
  stream: StreamDefaults;
}

export const DEFAULT_SETTINGS: AppSettings = {
  bridgeUrl: 'http://127.0.0.1:3001',
  stream: {
    volume: 70,
    muted: false,
    maxBitrate: 20,
    maxFps: 60,
    quality: 'auto',
    fsrEnabled: false,
    micEnabled: false,
    statsVisible: true,
  },
};

function readString(key: string, fallback: string): string {
  const raw = window.localStorage.getItem(key);
  return raw && raw.trim() ? raw.trim() : fallback;
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  const value = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === '1' || raw === 'true';
}

function readQuality(): StreamQualityPreset {
  const raw = window.localStorage.getItem(SETTINGS_KEYS.streamQuality);
  return raw === 'high' || raw === 'balanced' || raw === 'dataSaver' || raw === 'auto'
    ? raw
    : DEFAULT_SETTINGS.stream.quality;
}

export function readAppSettings(): AppSettings {
  return {
    bridgeUrl: readString(SETTINGS_KEYS.bridgeUrl, DEFAULT_SETTINGS.bridgeUrl),
    stream: {
      volume: readNumber(SETTINGS_KEYS.streamVolume, DEFAULT_SETTINGS.stream.volume, 0, 100),
      muted: readBool(SETTINGS_KEYS.streamMuted, DEFAULT_SETTINGS.stream.muted),
      maxBitrate: readNumber(SETTINGS_KEYS.streamBitrate, DEFAULT_SETTINGS.stream.maxBitrate, 3, 40),
      maxFps: readNumber(SETTINGS_KEYS.streamFps, DEFAULT_SETTINGS.stream.maxFps, 60, 120),
      quality: readQuality(),
      fsrEnabled: readBool(SETTINGS_KEYS.streamFsr, DEFAULT_SETTINGS.stream.fsrEnabled),
      micEnabled: readBool(SETTINGS_KEYS.streamMic, DEFAULT_SETTINGS.stream.micEnabled),
      statsVisible: readBool(SETTINGS_KEYS.streamStats, DEFAULT_SETTINGS.stream.statsVisible),
    },
  };
}

export function saveAppSettings(settings: AppSettings): void {
  window.localStorage.setItem(SETTINGS_KEYS.bridgeUrl, settings.bridgeUrl || DEFAULT_SETTINGS.bridgeUrl);
  window.localStorage.setItem(SETTINGS_KEYS.streamVolume, String(settings.stream.volume));
  window.localStorage.setItem(SETTINGS_KEYS.streamMuted, String(settings.stream.muted));
  window.localStorage.setItem(SETTINGS_KEYS.streamBitrate, String(settings.stream.maxBitrate));
  window.localStorage.setItem(SETTINGS_KEYS.streamFps, String(settings.stream.maxFps));
  window.localStorage.setItem(SETTINGS_KEYS.streamQuality, settings.stream.quality);
  window.localStorage.setItem(SETTINGS_KEYS.streamFsr, String(settings.stream.fsrEnabled));
  window.localStorage.setItem(SETTINGS_KEYS.streamMic, String(settings.stream.micEnabled));
  window.localStorage.setItem(SETTINGS_KEYS.streamStats, String(settings.stream.statsVisible));
}

export function resetAppSettings(): AppSettings {
  saveAppSettings(DEFAULT_SETTINGS);
  return readAppSettings();
}
