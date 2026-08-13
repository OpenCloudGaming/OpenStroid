import type { StreamLaunchResponse } from './types';

declare global {
  interface Window {
    openStroid?: {
      readSessionHandoff?(): Promise<string | null>;
      writeSessionHandoff?(value: string | null): Promise<{ persisted: boolean }>;
      openStream(launch: StreamLaunchResponse): Promise<{ ok: boolean }>;
      getStreamLaunch?(): Promise<StreamLaunchResponse | null>;
    };
  }
}

export {};
