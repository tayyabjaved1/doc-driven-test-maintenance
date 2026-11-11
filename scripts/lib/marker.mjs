import { artifactsDir } from './config.mjs';

/** The ran-marker path, shared between agent/PROCESS.md (which instructs the
 * agent to write it, as its own literal first action, using its file-write
 * tool -- never a shell `touch`, which may not be in its tool allowlist) and
 * validate-summary.mjs (which checks for it). A single shared constant so
 * the two can never drift apart -- see docs/ARCHITECTURE.md's guard #1. */
export function markerPath() {
  return `${artifactsDir()}/agent-ran.marker`;
}
