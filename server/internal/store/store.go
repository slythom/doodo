// Package store : accès PostgreSQL via pgx + migrations goose embarquées.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	goose "github.com/pressly/goose/v3"
)

//go:embed migrations
var migrationsFS embed.FS

var ErrNotFound = errors.New("introuvable")

// Store encapsule le pool de connexions.
type Store struct {
	pool *pgxpool.Pool
}

// Open ouvre la connexion et applique les migrations.
func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("pgxpool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	s := &Store{pool: pool}
	if err := s.Migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// Migrate applique les migrations goose embarquées.
func (s *Store) Migrate(ctx context.Context) error {
	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	db, err := sql.Open("pgx", s.pool.Config().ConnString())
	if err != nil {
		return err
	}
	defer db.Close()
	return goose.UpContext(ctx, db, "migrations")
}

func (s *Store) Close() { s.pool.Close() }

// Pool expose le pool pour les tests.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// ─── Users ───────────────────────────────────────────────────────────

// User : compte ou invité.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email,omitempty"`
	IsGuest      bool      `json:"isGuest"`
	IsAdmin      bool      `json:"isAdmin"`
	Avatar       string    `json:"avatar,omitempty"`
	GamesPlayed  int       `json:"gamesPlayed"`
	GamesWon     int       `json:"gamesWon"`
	CreatedAt    time.Time `json:"createdAt"`
	passwordHash string
}

// CreateGuest insère un utilisateur invité.
func (s *Store) CreateGuest(ctx context.Context, username string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (username, is_guest) VALUES ($1, true)
		 RETURNING id, username, is_guest, is_admin, games_played, games_won, created_at`,
		username,
	).Scan(&u.ID, &u.Username, &u.IsGuest, &u.IsAdmin, &u.GamesPlayed, &u.GamesWon, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// CreateAccount insère un compte complet.
func (s *Store) CreateAccount(ctx context.Context, username, email, passwordHash string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (username, email, password_hash, is_guest)
		 VALUES ($1, $2, $3, false)
		 RETURNING id, username, is_guest, is_admin, games_played, games_won, created_at`,
		username, email, passwordHash,
	).Scan(&u.ID, &u.Username, &u.IsGuest, &u.IsAdmin, &u.GamesPlayed, &u.GamesWon, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	u.Email = email
	return &u, nil
}

const userCols = `id, username, COALESCE(email,''), is_guest, is_admin,
	COALESCE(avatar,''), games_played, games_won, created_at,
	COALESCE(password_hash,'')`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.IsGuest, &u.IsAdmin,
		&u.Avatar, &u.GamesPlayed, &u.GamesWon, &u.CreatedAt, &u.passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetUserByID retrouve un utilisateur par son id.
func (s *Store) GetUserByID(ctx context.Context, id string) (*User, error) {
	return scanUser(s.pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE id = $1`, id))
}

// GetUserByLogin retrouve par email ou username.
func (s *Store) GetUserByLogin(ctx context.Context, login string) (*User, error) {
	return scanUser(s.pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE email = $1 OR username = $1`, login))
}

// PasswordHash expose le hash pour vérification bcrypt (champ interne).
func (u *User) PasswordHash() string { return u.passwordHash }

// ─── Refresh tokens ──────────────────────────────────────────────────

// SaveRefreshToken stocke le hash d'un refresh token.
func (s *Store) SaveRefreshToken(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, expiresAt)
	return err
}

// ConsumeRefreshToken vérifie et supprime un refresh token (rotation).
// Retourne le userID associé.
func (s *Store) ConsumeRefreshToken(ctx context.Context, tokenHash string) (string, error) {
	var userID string
	err := s.pool.QueryRow(ctx,
		`DELETE FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()
		 RETURNING user_id`, tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return userID, err
}

// RevokeUserTokens supprime tous les refresh tokens d'un utilisateur.
func (s *Store) RevokeUserTokens(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, userID)
	return err
}

// ─── Parties ─────────────────────────────────────────────────────────

// GameRecord : une partie persistée.
type GameRecord struct {
	ID        string
	Code      string
	Options   []byte
	Ranked    bool
	CreatedBy *string
	StartedAt time.Time
}

// InsertGame crée l'enregistrement au démarrage de la partie.
func (s *Store) InsertGame(ctx context.Context, code string, options []byte, ranked bool, createdBy *string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`INSERT INTO games (code, options, status, ranked, created_by, started_at)
		 VALUES ($1, $2, 'playing', $3, $4, now()) RETURNING id`,
		code, options, ranked, createdBy).Scan(&id)
	return id, err
}

// FinishGame marque la partie terminée.
func (s *Store) FinishGame(ctx context.Context, gameID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE games SET status = 'finished', finished_at = now() WHERE id = $1`, gameID)
	return err
}

// PlayerResult : résultat d'un joueur pour game_players.
type PlayerResult struct {
	UserID     *string
	IsBot      bool
	Seat       int
	FinalRank  int
	DiceLost   int
	CalzasWon  int
	CalzasLost int
}

// SaveGameResults insère les résultats et met à jour les stats des comptes.
func (s *Store) SaveGameResults(ctx context.Context, gameID string, players []PlayerResult) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, p := range players {
		_, err := tx.Exec(ctx,
			`INSERT INTO game_players (game_id, user_id, is_bot, seat, final_rank, dice_lost, calzas_won, calzas_lost)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			gameID, p.UserID, p.IsBot, p.Seat, p.FinalRank, p.DiceLost, p.CalzasWon, p.CalzasLost)
		if err != nil {
			return err
		}
		if p.UserID != nil && !p.IsBot {
			_, err := tx.Exec(ctx,
				`UPDATE users SET games_played = games_played + 1,
				 games_won = games_won + $2 WHERE id = $1`,
				*p.UserID, boolToInt(p.FinalRank == 1))
			if err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
