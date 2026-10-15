/// <reference types="vite/client" />
import type { ForgeApi } from '../shared/ipc';

declare global {
  interface Window {
    forge?: ForgeApi;
    /** Test/automation hooks (only read by the E2E suite). */
    __cforge?: Record<string, unknown>;
  }
}
