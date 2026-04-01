import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '../api/request';

interface DatasourceOnlineContextType {
  /** Map of datasource ID → online status */
  onlineStatus: Record<string, boolean>;
  /** Check if a datasource is online (true if online or unknown) */
  isOnline: (dsId: number) => boolean;
  /** Refresh online status */
  refresh: () => void;
  loading: boolean;
}

const DatasourceOnlineContext = createContext<DatasourceOnlineContextType>({
  onlineStatus: {},
  isOnline: () => true,
  refresh: () => {},
  loading: false,
});

export function DatasourceOnlineProvider({ children }: { children: ReactNode }) {
  const [onlineStatus, setOnlineStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.get<{ status: Record<string, boolean> }>('/datasource/online-status');
      setOnlineStatus(res.data.status || {});
    } catch {
      // ignore - keep existing status
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Refresh every 60s
    const timer = setInterval(fetchStatus, 60000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const isOnline = useCallback((dsId: number) => {
    const status = onlineStatus[String(dsId)];
    // If never checked, assume online (don't block user)
    return status === undefined ? true : status;
  }, [onlineStatus]);

  return (
    <DatasourceOnlineContext.Provider value={{ onlineStatus, isOnline, refresh: fetchStatus, loading }}>
      {children}
    </DatasourceOnlineContext.Provider>
  );
}

export const useDatasourceOnline = () => useContext(DatasourceOnlineContext);
