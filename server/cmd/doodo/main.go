package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"doodo/server/internal/api"
	"doodo/server/internal/hub"
	"doodo/server/internal/matchmaking"
	"doodo/server/internal/ws"
)

func main() {
	gameHub := hub.New(os.Getenv("GOD_ADMIN_KEY"))
	queue := matchmaking.New(gameHub.Create)
	apiSrv := api.NewServer(gameHub)
	wsSrv := ws.NewServer(gameHub, queue)

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Logger, middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	r.Route("/api", func(r chi.Router) {
		r.Get("/games", apiSrv.ListGames)
		r.Post("/games", apiSrv.CreateGame)
	})
	r.Get("/ws", wsSrv.ServeHTTP)

	srv := &http.Server{Addr: ":8080", Handler: r}

	go func() {
		slog.Info("doodo server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown failed", "err", err)
	}
}
