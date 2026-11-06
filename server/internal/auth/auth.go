// Package auth : JWT d'accès + refresh tokens rotatifs (spec tech §4/§8).
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	AccessTTL  = 24 * time.Hour      // une partie peut durer — token long
	RefreshTTL = 30 * 24 * time.Hour // 30 jours, rotatif
)

// Claims du JWT d'accès.
type Claims struct {
	UserID   string `json:"sub"`
	Username string `json:"name"`
	IsAdmin  bool   `json:"adm,omitempty"`
	IsGuest  bool   `json:"gst,omitempty"`
	Expires  int64  `json:"exp"`
}

// Service signe/vérifie les tokens. HS256 sans dépendance externe.
type Service struct {
	secret []byte
}

func NewService(secret string) (*Service, error) {
	if len(secret) < 16 {
		return nil, errors.New("JWT_SECRET trop court (≥16 car.)")
	}
	return &Service{secret: []byte(secret)}, nil
}

// Issue produit un access JWT + un refresh token opaque (hash à stocker).
func (s *Service) Issue(userID, username string, isAdmin, isGuest bool) (access string, refresh string, refreshHash string, exp time.Time, err error) {
	claims := Claims{
		UserID: userID, Username: username,
		IsAdmin: isAdmin, IsGuest: isGuest,
		Expires: time.Now().Add(AccessTTL).Unix(),
	}
	access, err = s.sign(claims)
	if err != nil {
		return "", "", "", time.Time{}, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", "", time.Time{}, err
	}
	refresh = base64.RawURLEncoding.EncodeToString(raw)
	return access, refresh, HashToken(refresh), time.Now().Add(RefreshTTL), nil
}

// HashToken : hash SHA-256 d'un refresh token (stockage — jamais le brut).
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Verify valide un access JWT et retourne ses claims.
func (s *Service) Verify(token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("jwt malformé")
	}
	if !s.validSig(parts[0]+"."+parts[1], parts[2]) {
		return nil, errors.New("signature invalide")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("payload invalide")
	}
	var c Claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, errors.New("claims invalides")
	}
	if time.Now().Unix() > c.Expires {
		return nil, errors.New("token expiré")
	}
	return &c, nil
}

// sign : HS256 = base64url(header).base64url(payload).base64url(hmac).
func (s *Service) sign(c Claims) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	body := header + "." + base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + s.signature(body), nil
}

func (s *Service) signature(body string) string {
	mac := computeHMAC(s.secret, []byte(body))
	return base64.RawURLEncoding.EncodeToString(mac)
}

func (s *Service) validSig(body, sig string) bool {
	expected := s.signature(body)
	// comparaison à temps constant
	if len(expected) != len(sig) {
		return false
	}
	var diff byte
	for i := range expected {
		diff |= expected[i] ^ sig[i]
	}
	return diff == 0
}
