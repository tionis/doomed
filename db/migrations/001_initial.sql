pragma foreign_keys = on;

create table if not exists users (
  id text primary key,
  display_name text not null,
  email text,
  avatar_url text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at text,
  banned_at text
);

create table if not exists user_identities (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  issuer text not null,
  subject text not null,
  email text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique(provider, issuer, subject)
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at text
);

create table if not exists games (
  id text primary key,
  code text not null unique,
  host_user_id text not null references users(id),
  status text not null,
  current_round_index integer not null default 0,
  current_round_id text references rounds(id),
  max_players integer not null default 10,
  round_count integer not null default 5,
  submission_seconds integer not null default 60,
  difficulty text not null default 'normal',
  mode text not null default 'score',
  reveal_mode text not null default 'one_by_one',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at text,
  constraint games_status_check check (status in ('lobby', 'round_intro', 'submitting', 'judging', 'revealing', 'scoreboard', 'finished', 'abandoned')),
  constraint games_difficulty_check check (difficulty in ('easy', 'normal', 'ruthless')),
  constraint games_reveal_mode_check check (reveal_mode in ('one_by_one', 'all_at_once'))
);

create table if not exists game_players (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  user_id text not null references users(id),
  display_name text not null,
  seat_index integer not null,
  is_host integer not null default 0,
  ready integer not null default 0,
  connected integer not null default 0,
  alive integer not null default 1,
  score integer not null default 0,
  survival_count integer not null default 0,
  death_count integer not null default 0,
  joined_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  left_at text,
  unique(game_id, user_id),
  unique(game_id, seat_index)
);

create table if not exists rounds (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  round_index integer not null,
  status text not null,
  scenario_title text not null,
  scenario_text text not null,
  immediate_threat text not null,
  time_pressure text not null,
  category text not null,
  difficulty integer not null,
  submission_deadline_at text,
  reveal_index integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique(game_id, round_index),
  constraint rounds_status_check check (status in ('round_intro', 'submitting', 'judging', 'revealing', 'scoreboard', 'complete'))
);

create table if not exists submissions (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  round_id text not null references rounds(id) on delete cascade,
  player_id text not null references game_players(id) on delete cascade,
  user_id text not null references users(id),
  text text not null,
  submitted_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  locked integer not null default 0,
  unique(round_id, player_id)
);

create table if not exists judgments (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  game_id text not null references games(id) on delete cascade,
  round_id text not null references rounds(id) on delete cascade,
  player_id text not null references game_players(id) on delete cascade,
  submission_id text not null references submissions(id) on delete cascade,
  logic_score integer not null,
  creativity_score integer not null,
  feasibility_score integer not null,
  humor_score integer not null,
  verdict text not null,
  survived integer not null,
  points_awarded integer not null,
  outcome text not null,
  judge_comment text not null,
  cause_of_death text,
  anti_cheat_flags text not null default '[]',
  model_name text not null,
  raw_model_output text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique(round_id, player_id),
  unique(submission_id),
  constraint judgments_verdict_check check (verdict in ('survived', 'barely_survived', 'perished'))
);

create table if not exists game_events (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  game_id text not null references games(id) on delete cascade,
  round_id text references rounds(id) on delete cascade,
  actor_user_id text references users(id),
  type text not null,
  payload text not null default '{}',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists ai_usage_logs (
  id text primary key default (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id text references users(id),
  game_id text references games(id) on delete cascade,
  round_id text references rounds(id) on delete cascade,
  provider text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cost_estimate_cents integer,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists rate_limits (
  key text primary key,
  count integer not null,
  reset_at text not null
);

create index if not exists sessions_live_idx on sessions(user_id, expires_at) where revoked_at is null;
create index if not exists game_players_game_idx on game_players(game_id) where left_at is null;
create index if not exists rounds_game_idx on rounds(game_id, round_index);
create index if not exists submissions_round_idx on submissions(round_id);
create index if not exists judgments_round_idx on judgments(round_id);
create index if not exists game_events_game_idx on game_events(game_id, created_at);
