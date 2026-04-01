import { api } from './request';

export interface PluginInfo {
  name: string;
  display_name: string;
  display_name_en: string;
  version: string | null;
  description: string | null;
  author: string | null;
  license: string;
  layer: string;
  category: string;
  enabled: boolean;
  loaded: boolean;
  authorized?: boolean;
  frontend: Record<string, any>;
}

export async function fetchAllPlugins(): Promise<PluginInfo[]> {
  const res = await api.get('/plugins/all');
  return res.data.plugins;
}

export async function togglePlugin(pluginId: string, enabled: boolean): Promise<{ plugin_id: string; enabled: boolean; message: string }> {
  const res = await api.put(`/plugins/${pluginId}/toggle`, { enabled });
  return res.data;
}
