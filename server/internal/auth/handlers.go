package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"doodo/server/internal/store"
)

// Handlers expose les endpoints /api/auth/*.
type Handlers struct {
	store   *store.Store
	service *Service
}

func NewHandlers(st *store.Store, svc *Service) *Handlers {
	return &Handlers{store: st, service: svc}
}

var usernameRe = regexp.MustCompile(`^[\w\-]{2,20}$`)

func validUsername(u string) bool { return usernameRe.MatchString(u) }

type authResponse struct {
	AccessToken  string      `json:"accessToken"`
	RefreshToken string      `json:"refreshToken"`
	User         *store.User `json:"user"`
}

func (h *Handlers) respondAuth(w http.ResponseWriter, r *http.Request, u *store.User) {
	access, refresh, hash, exp, err := h.service.Issue(u.ID, u.Username, u.IsAdmin, u.IsGuest)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "issue_failed")
		return
	}
	if err := h.store.SaveRefreshToken(r.Context(), u.ID, hash, exp); err != nil {
		writeErr(w, http.StatusInternalServerError, "token_save_failed")
		return
	}
	writeJSON(w, http.StatusOK, authResponse{AccessToken: access, RefreshToken: refresh, User: u})
}

// Guest : POST /api/auth/guest {username} → compte invité + tokens.
func (h *Handlers) Guest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !validUsername(req.Username) {
		writeErr(w, http.StatusBadRequest, "bad_username")
		return
	}
	u, err := h.store.CreateGuest(r.Context(), req.Username)
	if err != nil {
		// Pseudo déjà pris : suffixe aléatoire pour les invités.
		u, err = h.store.CreateGuest(r.Context(), req.Username+"#"+rand4())
		if err != nil {
			writeErr(w, http.StatusConflict, "username_taken")
			return
		}
	}
	h.respondAuth(w, r, u)
}

// Register : POST /api/auth/register {username, email, password}.
func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil ||
		!validUsername(req.Username) || !strings.Contains(req.Email, "@") || len(req.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash_failed")
		return
	}
	u, err := h.store.CreateAccount(r.Context(), req.Username, req.Email, string(hash))
	if err != nil {
		writeErr(w, http.StatusConflict, "username_or_email_taken")
		return
	}
	h.respondAuth(w, r, u)
}

// Login : POST /api/auth/login {login, password}.
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	u, err := h.store.GetUserByLogin(r.Context(), req.Login)
	if err != nil || u.PasswordHash() == "" ||
		bcrypt.CompareHashAndPassword([]byte(u.PasswordHash()), []byte(req.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	h.respondAuth(w, r, u)
}

// Refresh : POST /api/auth/refresh {refreshToken} → rotation (l'ancien
// token est consommé et un nouveau couple est émis).
func (h *Handlers) Refresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	userID, err := h.store.ConsumeRefreshToken(r.Context(), HashToken(req.RefreshToken))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_refresh")
		return
	}
	u, err := h.store.GetUserByID(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid_refresh")
		return
	}
	h.respondAuth(w, r, u)
}

// Logout : POST /api/auth/logout {refreshToken} → révocation du token.
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.RefreshToken != "" {
		_, _ = h.store.ConsumeRefreshToken(r.Context(), HashToken(req.RefreshToken))
	}
	w.WriteHeader(http.StatusNoContent)
}

// Me : GET /api/me (Bearer access) → profil + stats.
func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	c := ClaimsFromContext(r.Context())
	if c == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	u, err := h.store.GetUserByID(r.Context(), c.UserID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "user_not_found")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func rand4() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"code": code})
}
