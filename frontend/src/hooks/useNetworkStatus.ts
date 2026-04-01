import { useState, useEffect, useCallback } from 'react';
import { getNetworkStatus } from '../api/networkStatus';

let cachedOnline: boolean | null = null;
let lastCheck = 0;
const CACHE_MS = 30_000; // 30 seconds client-side cache

/**
 * Hook that returns { online, loading, refresh }.
 * Caches result across component instances for 30s.
 */
export function useNetworkStatus() {
  const [online, setOnline] = useState<boolean | null>(cachedOnline);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getNetworkStatus();
      cachedOnline = res.data.online;
      lastCheck = Date.now();
      setOnline(cachedOnline);
    } catch {
      // If we can't reach our own backend, assume offline
      cachedOnline = false;
      lastCheck = Date.now();
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedOnline === null || Date.now() - lastCheck > CACHE_MS) {
      refresh();
    }
  }, [refresh]);

  return { online, loading, refresh };
}
