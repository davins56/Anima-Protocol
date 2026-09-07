CREATE TABLE IF NOT EXISTS intimacy_profiles (
  user_id            text NOT NULL,
  character_id       text NOT NULL,
  heat               integer NOT NULL DEFAULT 0,
  bond_erotic        integer NOT NULL DEFAULT 0,
  power_axis         real NOT NULL DEFAULT 0,
  preferred_pace     text NOT NULL DEFAULT 'slow',
  anatomy            jsonb NOT NULL DEFAULT '{}'::jsonb,
  kinks              text[] NOT NULL DEFAULT '{}',
  limits             text[] NOT NULL DEFAULT '{}',
  soft_limits        text[] NOT NULL DEFAULT '{}',
  safeword           text NOT NULL DEFAULT 'red',
  aftercare_style    text NOT NULL DEFAULT 'quiet grounding, closeness, verbal check-in',
  last_scene_at      timestamptz,
  scene_count        integer NOT NULL DEFAULT 0,
  intimacy_enabled   boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS intimacy_scenes (
  id                 text PRIMARY KEY,
  conversation_id    text NOT NULL,
  character_id       text NOT NULL,
  user_id            text NOT NULL,
  phase              text NOT NULL DEFAULT 'closed',
  location           text,
  clothing_state     jsonb NOT NULL DEFAULT '{}'::jsonb,
  focus_map          jsonb NOT NULL DEFAULT '{}'::jsonb,
  acts_log           jsonb NOT NULL DEFAULT '[]'::jsonb,
  heat_peak          integer NOT NULL DEFAULT 0,
  ended_reason       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intimacy_scenes_conv_idx
  ON intimacy_scenes (conversation_id, updated_at DESC);
