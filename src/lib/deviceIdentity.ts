export type DeviceKind = 'mobile' | 'tablet' | 'desktop';

export interface LocalDeviceInfo {
  id: string;
  name: string;
  type: DeviceKind;
}

const DEVICE_ID_KEY = 'kora_connect_device_id';

function detectDeviceMeta(): { name: string; type: DeviceKind } {
  if (typeof navigator === 'undefined') {
    return { name: 'Appareil Kora', type: 'desktop' };
  }
  const ua = navigator.userAgent || '';
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    '';

  if (/iPhone/i.test(ua)) return { name: 'iPhone', type: 'mobile' };
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return { name: 'iPad', type: 'tablet' };
  }
  if (/Android/i.test(ua)) {
    if (/Mobile/i.test(ua)) return { name: 'Android', type: 'mobile' };
    return { name: 'Tablette Android', type: 'tablet' };
  }
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return { name: 'PC Windows', type: 'desktop' };
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return { name: 'Mac', type: 'desktop' };
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return { name: 'PC Linux', type: 'desktop' };
  return { name: 'Navigateur', type: 'desktop' };
}

let cachedDevice: LocalDeviceInfo | null = null;

export function getLocalDeviceInfo(): LocalDeviceInfo {
  if (cachedDevice) return cachedDevice;
  let id = '';
  if (typeof window !== 'undefined') {
    try {
      id = window.localStorage.getItem(DEVICE_ID_KEY) || '';
      if (!id) {
        id = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
        window.localStorage.setItem(DEVICE_ID_KEY, id);
      }
    } catch {
      id = `dev_${Math.random().toString(36).slice(2, 10)}`;
    }
  } else {
    id = 'dev_ssr';
  }
  const { name, type } = detectDeviceMeta();
  cachedDevice = { id, name, type };
  return cachedDevice;
}
