-- +goose Up
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text NOT NULL UNIQUE,
    email         text UNIQUE,
    password_hash text,
    is_guest      boolean NOT NULL DEFAULT true,
    is_admin      boolean NOT NULL DEFAULT false,
    avatar        text,
    games_played  integer NOT NULL DEFAULT 0,
    games_won     integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text,
    options     jsonb NOT NULL,
    status      text NOT NULL,           -- waiting | playing | finished | aborted
    ranked      boolean NOT NULL DEFAULT false, -- éligible stats (rankedSafe, pas de mode dieu)
    created_by  uuid REFERENCES users(id),
    started_at  timestamptz,
    finished_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_players (
    game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id      uuid REFERENCES users(id),        -- NULL pour les bots
    is_bot       boolean NOT NULL DEFAULT false,
    seat         smallint NOT NULL,
    final_rank   smallint,
    dice_lost    smallint NOT NULL DEFAULT 0,
    calzas_won   smallint NOT NULL DEFAULT 0,
    calzas_lost  smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, seat)
);

CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_game_players_user ON game_players(user_id);
CREATE INDEX idx_games_created_by ON games(created_by);

-- +goose Down
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS game_players;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS users;
