package store

import (
	"context"
	"os"
	"testing"
	"time"
)

// Tests d'intégration : nécessitent DATABASE_URL (postgres en local ou CI).
// Skippés sinon — le coverage métier est assuré par les autres packages.
func openTestStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL absent — test d'intégration skippé")
	}
	st, err := Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(st.Close)
	// Nettoyage pour un test isolé.
	_, _ = st.Pool().Exec(context.Background(),
		`TRUNCATE refresh_tokens, game_players, games, users CASCADE`)
	return st
}

func TestGuestAndTokens(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	u, err := st.CreateGuest(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if u.ID == "" || !u.IsGuest {
		t.Errorf("user=%+v", u)
	}
	if _, err := st.CreateGuest(ctx, "alice"); err == nil {
		t.Error("username dupliqué accepté")
	}

	exp := time.Now().Add(time.Hour)
	if err := st.SaveRefreshToken(ctx, u.ID, "hash1", exp); err != nil {
		t.Fatal(err)
	}
	uid, err := st.ConsumeRefreshToken(ctx, "hash1")
	if err != nil || uid != u.ID {
		t.Fatalf("consume: %v uid=%s", err, uid)
	}
	if _, err := st.ConsumeRefreshToken(ctx, "hash1"); err == nil {
		t.Error("token consommé deux fois")
	}
}

func TestGameResults(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	u, _ := st.CreateAccount(ctx, "bob", "bob@x.io", "hash")
	opts := []byte(`{"diceCount":5}`)
	gameID, err := st.InsertGame(ctx, "ABC123", opts, true, &u.ID)
	if err != nil {
		t.Fatal(err)
	}
	err = st.SaveGameResults(ctx, gameID, []PlayerResult{
		{UserID: &u.ID, Seat: 0, FinalRank: 1},
		{IsBot: true, Seat: 1, FinalRank: 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.FinishGame(ctx, gameID); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetUserByID(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.GamesPlayed != 1 || got.GamesWon != 1 {
		t.Errorf("stats=%d/%d want 1/1", got.GamesPlayed, got.GamesWon)
	}
}
