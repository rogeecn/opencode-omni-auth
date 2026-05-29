const OMNIROUTE_DEBUG = 'OMNIROUTE_DEBUG';

function isDebugEnabled(): boolean {
  return (
    process.env[OMNIROUTE_DEBUG] === '1' ||
    process.env[OMNIROUTE_DEBUG] === 'true' ||
    process.env[OMNIROUTE_DEBUG] === 'yes'
  );
}

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log(...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
}

export function debugError(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.error(...args);
  }
}