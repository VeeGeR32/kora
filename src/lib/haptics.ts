/**
 * Cross-platform tactile haptic tick:
 * - iOS 17.4+ / iOS 18 / iOS 26 Safari & Home Screen PWA: triggers native Taptic Engine
 *   by toggling a hidden `<input type="checkbox" switch />` via its `<label>`.
 * - Android / Chrome: uses `navigator.vibrate(6)`.
 */

let iosHapticLabel: HTMLLabelElement | null = null;
let lastHapticAt = 0;

function ensureIosHapticSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (iosHapticLabel && document.body.contains(iosHapticLabel)) return iosHapticLabel;

  const id = 'kora-ios-haptic-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';

  document.body.appendChild(input);
  document.body.appendChild(label);
  iosHapticLabel = label;
  return label;
}

export function triggerHapticTick(minIntervalMs = 28): void {
  if (typeof window === 'undefined') return;
  const now = performance.now();
  if (now - lastHapticAt < minIntervalMs) return;
  lastHapticAt = now;

  // Android / supported browsers
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(6);
      return;
    } catch {
      // fall through
    }
  }

  // iOS Safari / PWA native Taptic Engine switch trick
  try {
    const label = ensureIosHapticSwitch();
    label?.click();
  } catch {
    // ignore unsupported environments
  }
}
