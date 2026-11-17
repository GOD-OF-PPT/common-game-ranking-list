export interface Database {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Config {
  adminKey: string;
  playerSecret: string;
  corsOrigins: string[] | '*';
  logger?: boolean;
  trustProxy?: boolean | ((address: string, hop: number) => boolean);
}
export interface Game {
  id: string;
  slug: string;
  name: string;
  api_key_hash: string;
  allow_guest: boolean;
  created_at: Date | string;
}
export interface SortRule {
  field: string;
  order: 'asc' | 'desc';
}
export interface Board {
  id: string;
  game_id: string;
  slug: string;
  name: string;
  sort_rules: SortRule[];
  update_mode: 'best' | 'latest';
  public: boolean;
  created_at: Date | string;
}
export interface Entry {
  player_id: string;
  username: string;
  metrics: Record<string, number>;
  info: Record<string, unknown>;
  achieved_at: Date | string;
  rank: string | number;
}
