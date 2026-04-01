/**
 * Find the first online datasource from a list.
 * Uses onlineStatus from Context if provided, otherwise falls back to last_test_status.
 * Returns undefined if no online datasource found (don't auto-select offline).
 */
export function findFirstHealthyDs<
  T extends { id: number; status?: string; last_test_status?: string | null },
>(items: T[], onlineStatus?: Record<string, boolean>): T | undefined {
  if (!items.length) return undefined;

  // If Context online status is available, use it
  if (onlineStatus && Object.keys(onlineStatus).length > 0) {
    return items.find(d => d.status === 'enabled' && onlineStatus[String(d.id)] === true);
  }

  // Fallback: prefer tested-online, then untested, skip failed
  return (
    items.find(d => d.status === 'enabled' && d.last_test_status === 'success') ||
    items.find(d => d.status === 'enabled' && d.last_test_status !== 'failed')
  );
}
