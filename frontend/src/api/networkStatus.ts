import { api } from './request';

export interface NetworkStatus {
  online: boolean;
  checked_at: string;
}

export function getNetworkStatus() {
  return api.get<NetworkStatus>('/system/network-status');
}
