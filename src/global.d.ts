import type { StreamLaunchResponse } from './types';

declare global {
  interface Window {
    openStroid?: {
      openStream(launch: StreamLaunchResponse): Promise<{ ok: boolean }>;
      getStreamLaunch?(): Promise<StreamLaunchResponse | null>;
    };
  }
}

export {};
