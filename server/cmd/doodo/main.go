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
	"doodo/server/internal/auth"
	"doodo/server/internal/hub"
	"doodo/server/internal/matchmaking"
	"doodo/server/internal/store"
	"doodo/server/internal/ws"
)

func main() {
	gameHub := hub.New(os.Getenv("GOD_ADMIN_KEY"))
	queue := matchmaking.New(gameHub.Create)

	// Persistance + auth : activées si DATABASE_URL est défini.
	var authSvc *auth.Service
	var st *store.Store
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		var err error
		st, err = store.Open(context.Background(), dbURL)
		if err != nil {
			slog.Error("db open failed", "err", err)
			os.Exit(1)
		}
		defer st.Close()
		gameHub.SetPersister(store.NewPersister(st))

		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			slog.Error("JWT_SECRET requis quand DATABASE_URL est défini")
			os.Exit(1)
		}
		svc, err := auth.NewService(secret)
		if err != nil {
			slog.Error("auth init failed", "err", err)
			os.Exit(1)
		}
		authSvc = svc
		slog.Info("persistence + auth enabled")
	} else {
		slog.Warn("DATABASE_URL absent — mode sans persistance ni comptes")
	}

	apiSrv := api.NewServer(gameHub)
	wsSrv := ws.NewServer(gameHub, queue, authSvc)

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Logger, middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	r.Route("/api", func(r chi.Router) {
		r.Get("/games", apiSrv.ListGames)
		r.Post("/games", apiSrv.CreateGame)

		if authSvc != nil {
			ah := auth.NewHandlers(st, authSvc)
			limiter := api.NewRateLimiter(10, time.Minute)
			r.Group(func(r chi.Router) {
				r.Use(limiter.Limit)
				r.Post("/auth/guest", ah.Guest)
				r.Post("/auth/register", ah.Register)
				r.Post("/auth/login", ah.Login)
				r.Post("/auth/refresh", ah.Refresh)
				r.Post("/auth/logout", ah.Logout)
			})
			r.With(authSvc.Middleware).Get("/me", ah.Me)
		}
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
