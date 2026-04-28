import type { StreamLaunchResponse } from './types';

declare global {
  interface Window {
    openStroid?: {
      openStream(launch: StreamLaunchResponse): Promise<{ ok: boolean }>;
    };
  }
}

export {};
