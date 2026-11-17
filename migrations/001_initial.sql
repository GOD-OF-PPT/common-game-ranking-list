CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY,
  slug varchar(64) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  api_key_hash text NOT NULL,
  allow_guest boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leaderboards (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slug varchar(64) NOT NULL,
  name varchar(100) NOT NULL,
  sort_rules jsonb NOT NULL,
  update_mode text NOT NULL CHECK (update_mode IN ('best', 'latest')),
  public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, slug)
);
CREATE TABLE IF NOT EXISTS entries (
  leaderboard_id uuid NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
  player_id varchar(128) NOT NULL,
  username varchar(80) NOT NULL,
  metrics jsonb NOT NULL,
  info jsonb NOT NULL DEFAULT '{}',
  sort_values double precision[] NOT NULL,
  achieved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (leaderboard_id, player_id)
);
CREATE INDEX IF NOT EXISTS entries_ranking ON entries
  (leaderboard_id, sort_values, achieved_at, player_id);
