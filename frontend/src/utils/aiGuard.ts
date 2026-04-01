import { Modal } from 'antd';
import { getNetworkStatus } from '../api/networkStatus';
import { getAIConfig } from '../api/aiConfig';

let _cachedOnline: boolean | null = null;
let _lastCheck = 0;
const CACHE_MS = 30_000;

/**
 * Check if AI features are usable. If not, show a friendly modal and return false.
 * Call this before opening any AI panel / dialog.
 *
 * Usage:
 *   const ok = await checkAIAvailable();
 *   if (!ok) return;
 *   // proceed with AI action
 */
/**
 * Silent check — returns boolean without showing any modal.
 * Use this for pre-checking on page mount to control button visibility.
 */
export async function isAIAvailable(): Promise<boolean> {
  try {
    const configRes = await getAIConfig();
    if (!configRes.data.ai_enabled) return false;
  } catch {
    return false;
  }
  const now = Date.now();
  if (_cachedOnline === null || now - _lastCheck > CACHE_MS) {
    try {
      const res = await getNetworkStatus();
      _cachedOnline = res.data.online;
      _lastCheck = Date.now();
    } catch {
      _cachedOnline = false;
      _lastCheck = Date.now();
    }
  }
  return _cachedOnline !== false;
}

export async function checkAIAvailable(): Promise<boolean> {
  // 1. Check if AI is configured
  try {
    const configRes = await getAIConfig();
    const cfg = configRes.data;
    if (!cfg.ai_enabled) {
      Modal.warning({
        title: 'AI 功能未启用',
        content: '请先在系统设置 → AI 配置中启用 AI 功能。',
      });
      return false;
    }
  } catch {
    // Can't fetch config — fall through to network check
  }

  // 2. Check network (with cache)
  const now = Date.now();
  if (_cachedOnline === null || now - _lastCheck > CACHE_MS) {
    try {
      const res = await getNetworkStatus();
      _cachedOnline = res.data.online;
      _lastCheck = Date.now();
    } catch {
      _cachedOnline = false;
      _lastCheck = Date.now();
    }
  }

  if (_cachedOnline === false) {
    Modal.warning({
      title: '网络未连接',
      content: 'AI 功能需要联网使用，请检查网络连接。',
    });
    return false;
  }

  return true;
}
