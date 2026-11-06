package auth

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func svc(t *testing.T) *Service {
	t.Helper()
	s, err := NewService("test-secret-au-moins-16")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestIssueVerifyRoundtrip(t *testing.T) {
	s := svc(t)
	access, refresh, hash, _, err := s.Issue("uid1", "alice", true, false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.Verify(access)
	if err != nil {
		t.Fatal(err)
	}
	if c.UserID != "uid1" || c.Username != "alice" || !c.IsAdmin || c.IsGuest {
		t.Errorf("claims=%+v", c)
	}
	if refresh == "" || hash != HashToken(refresh) {
		t.Error("refresh/hash incohérents")
	}
	if HashToken("autre") == hash {
		t.Error("hash collision")
	}
}

func TestVerifyRejects(t *testing.T) {
	s := svc(t)
	access, _, _, _, _ := s.Issue("uid1", "a", false, false)

	if _, err := s.Verify(access + "x"); err == nil {
		t.Error("signature altérée acceptée")
	}
	if _, err := s.Verify("pas.un.jwt"); err == nil {
		t.Error("jwt malformé accepté")
	}
	// secret différent → rejet
	s2, _ := NewService("autre-secret-16-chars")
	if _, err := s2.Verify(access); err == nil {
		t.Error("token d'un autre secret accepté")
	}
	// expiré : forger un token expiré avec le bon secret
	parts := splitToken(access)
	payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var c Claims
	_ = json.Unmarshal(payload, &c)
	c.Expires = time.Now().Add(-time.Hour).Unix()
	expired, _ := s.sign(c)
	if _, err := s.Verify(expired); err == nil {
		t.Error("token expiré accepté")
	}
}

func splitToken(tok string) [3]string {
	var out [3]string
	i, j := 0, 0
	for idx, ch := range tok {
		if ch == '.' {
			if j == 0 {
				out[0] = tok[:idx]
			} else {
				out[1] = tok[i:idx]
			}
			j++
			i = idx + 1
		}
	}
	out[2] = tok[i:]
	return out
}

func TestNewServiceShortSecret(t *testing.T) {
	if _, err := NewService("court"); err == nil {
		t.Error("secret court accepté")
	}
}
