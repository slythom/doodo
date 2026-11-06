package hub

import (
	"testing"

	"doodo/server/internal/proto"
)

func TestCreateGetList(t *testing.T) {
	h := New("secret")
	opts := proto.DefaultTableOptions()

	a, code, err := h.Create(opts, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Errorf("code=%q len=%d", code, len(code))
	}
	if h.Get(code) != a {
		t.Error("Get ne retrouve pas la partie")
	}
	if h.Get("XXXXXX") != nil {
		t.Error("Get inconnu devrait être nil")
	}

	rooms := h.ListPublic()
	if len(rooms) != 1 || rooms[0].Code != code {
		t.Errorf("ListPublic=%v", rooms)
	}

	// Non publique → absente du lobby.
	_, code2, _ := h.Create(opts, false)
	for _, r := range h.ListPublic() {
		if r.Code == code2 {
			t.Error("salle privée listée dans le lobby")
		}
	}

	h.Remove(code)
	if h.Get(code) != nil {
		t.Error("Remove n'a pas supprimé la partie")
	}

	if !h.AdminKey("secret") || h.AdminKey("nope") {
		t.Error("AdminKey incorrect")
	}
}
