package auth

import (
	"context"
	"net/http"
	"strings"
)

type claimsKey struct{}

// Middleware injecte les claims du Bearer token dans le contexte
// (nil si absent/invalide — les handlers décident).
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if strings.HasPrefix(h, "Bearer ") {
			if c, err := s.Verify(strings.TrimPrefix(h, "Bearer ")); err == nil {
				r = r.WithContext(context.WithValue(r.Context(), claimsKey{}, c))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ClaimsFromContext retourne les claims du contexte ou nil.
func ClaimsFromContext(ctx context.Context) *Claims {
	c, _ := ctx.Value(claimsKey{}).(*Claims)
	return c
}
