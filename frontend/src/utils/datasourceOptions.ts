import type { Datasource } from '../api/datasource';

/**
 * Build Select options for datasource dropdown with online status.
 * onlineStatus: Record<string, boolean> from DatasourceOnlineContext
 */
export function buildDatasourceOptions(
  datasources: Datasource[],
  onlineStatus?: Record<string, boolean>,
) {
  return datasources.map(ds => {
    const key = String(ds.id);
    const checked = onlineStatus && key in onlineStatus;
    const online = checked ? onlineStatus[key] : true; // unchecked = assume online
    const statusText = checked ? (online ? '在线' : '离线') : '';
    return {
      label: `${ds.datasource_name} (${ds.db_type})${statusText ? ` [${statusText}]` : ''}`,
      value: ds.id,
      disabled: checked && !online,
    };
  });
}
