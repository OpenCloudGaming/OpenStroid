export const MIN_STREAM_BITRATE_MBPS = 3;
export const MAX_STREAM_BITRATE_MBPS = 150;

export type StreamQualityPreset = 'auto' | 'high' | 'balanced' | 'dataSaver';
export type StreamResolutionPreset = 'auto' | '720p' | '1080p' | '1440p' | '2160p';
export type StreamEncodingPreset = 'auto' | 'h264' | 'av1';

export interface StreamResolutionOption {
  value: StreamResolutionPreset;
  label: string;
  width: number | null;
  height: number | null;
}

export const STREAM_QUALITY_OPTIONS: Array<{ value: StreamQualityPreset; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'dataSaver', label: 'Low' },
];

export const STREAM_RESOLUTION_OPTIONS: StreamResolutionOption[] = [
  { value: 'auto', label: 'Auto', width: null, height: null },
  { value: '720p', label: '720p', width: 1280, height: 720 },
  { value: '1080p', label: '1080p', width: 1920, height: 1080 },
  { value: '1440p', label: '1440p', width: 2560, height: 1440 },
  { value: '2160p', label: '4K', width: 3840, height: 2160 },
];

export const STREAM_ENCODING_OPTIONS: Array<{ value: StreamEncodingPreset; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'h264', label: 'H.264' },
  { value: 'av1', label: 'AV1' },
];

export function isStreamQualityPreset(value: unknown): value is StreamQualityPreset {
  return typeof value === 'string' && STREAM_QUALITY_OPTIONS.some((option) => option.value === value);
}

export function isStreamResolutionPreset(value: unknown): value is StreamResolutionPreset {
  return typeof value === 'string' && STREAM_RESOLUTION_OPTIONS.some((option) => option.value === value);
}

export function isStreamEncodingPreset(value: unknown): value is StreamEncodingPreset {
  return typeof value === 'string' && STREAM_ENCODING_OPTIONS.some((option) => option.value === value);
}

export function resolutionForPreset(value: StreamResolutionPreset): StreamResolutionOption | null {
  return STREAM_RESOLUTION_OPTIONS.find((option) => option.value === value && option.width && option.height) ?? null;
}
