# Specs techniques — Doodo (Perudo en ligne)

Document compagnon de `specs_fonctionnelles.md`. Décrit l'architecture, le stack, le modèle de données et le protocole temps réel.

---

## 1. Stack choisi

| Couche | Choix | Justification |
|---|---|---|
| Backend | **Go** (stdlib `net/http` + `chi` pour le routage REST) | Exige utilisateur ; excellent pour WebSockets/concurrence ; binaire unique facile à déployer |
| WebSocket | **`coder/websocket`** (ex-nhooyr) | Maintenu, API propre ; alternative : `gorilla/websocket` |
| Frontend | **Expo / React Native + Expo Router** | **App iOS/Android native en v1** (builds EAS, stores) ; version web optionnelle ultérieure via `react-native-web` |
| 3D | **Three.js + React Three Fiber + `expo-gl`** | Scène de table 3D vue 1ʳᵉ personne sur natif ; assets glTF low-poly |
| State front | **Zustand** | Léger, adapté à un store d'état de jeu piloté par événements WS |
| Styles | **StyleSheet RN** (+ NativeWind optionnel) | UI native : HUD, menus, lobby en composants RN |
| BDD | **PostgreSQL** | Comptes, stats, historique de parties |
| Cache/session | **In-memory (v1)** | État des parties en RAM sur le nœud unique ; **Redis** réservé pour v2 (multi-instance, file matchmaking distribuée) |
| ORM/DB | **`sqlc`** ou `pgx` + SQL brut | Typé, simple, pas d'ORM lourd |
| Auth | **Tokens bearer (JWT)** + refresh | `expo-secure-store` sur mobile ; réutilisable tel quel par un client web futur |
| Repo | **Monorepo** (pnpm workspaces ou Turborepo) | `apps/` + `packages/shared` (types protocole, logique client) réutilisés par tout client futur |
| Déploiement | **Docker Compose sur VPS** + Caddy (TLS auto) | Exige utilisateur ; un seul conteneur app + un postgres |

Tout est mono-process en v1 : le serveur Go tient l'état des parties en mémoire et sert l'API + les WebSockets. Le scaling horizontal nécessitera Redis pub/sub ou du sticky-routing — documenté en §9.

---

## 2. Architecture globale

```
┌────────────┐   WSS / HTTPS    ┌──────────────────────────┐
│  Client     │ ◄────────────► │  Serveur Go              │
│  React SPA  │                │  ├─ HTTP API (chi)       │
│  (Vite)     │                │  ├─ Hub WebSocket        │
└────────────┘                │  ├─ GameManager          │
                              │  │   └─ Game actors      │
                              │  ├─ Matchmaking queue    │
                              │  └─ Bot engine           │
                              └──────┬───────────────────┘
                                     │ pgx
                              ┌──────▼──────┐
                              │ PostgreSQL  │
                              └─────────────┘
```

**Point clé : le serveur est l'autorité unique.** Les clients n'envoient que des *intentions* (enchère, dudo, calza) ; le serveur valide, lance les dés (RNG serveur), fait avancer la machine à états et diffuse les événements — en **filtrant par joueur** (chacun ne reçoit que ses propres dés).

### Machine à états d'une partie

```
LOBBY ──(creator: start)──► ROUND_ROLL ──► BIDDING ◄──┐
                                ▲                    │ bid
                                │            ┌───────┤
                                │            ▼       │
                                │      RESOLVING (dudo/calza)
                                │            │
                                └── next round ──────┘
                                        │
                                        ▼ (1 joueur restant)
                                      ENDED ──► lobby/fin
```

Une partie = une goroutine (acteur) avec une mailbox d'événements entrants ; évite les mutex complexes, sérialise naturellement les actions.

---

## 3. Modèle de données (PostgreSQL)

```sql
users(
  id            uuid pk,
  username      text unique not null,
  email         text unique,           -- null si invité converti jamais
  password_hash text,                  -- null si invité
  is_guest      bool not null default true,
  avatar        text,
  created_at    timestamptz not null
)

games(
  id            uuid pk,
  code          text,                  -- code salle privée (null si matchmaking)
  options       jsonb not null,        -- config table (§1.3 spec fonc.) + customRules[] + godMode
  status        text not null,         -- waiting | playing | finished | aborted
  created_by    uuid fk users,
  started_at    timestamptz,
  finished_at   timestamptz
)

game_players(
  game_id       uuid fk games,
  user_id       uuid fk users,         -- ou bot_id null + flag is_bot
  is_bot        bool not null,
  seat          smallint not null,     -- ordre de table
  final_rank    smallint,              -- 1 = gagnant
  dice_lost     smallint,
  calzas_won    smallint,
  calzas_lost   smallint,
  pk (game_id, seat)
)

-- v2
friendships(user_id, friend_id, status, created_at)
elo_ratings(user_id, rating, games_played, updated_at)
```

Les parties **en cours** vivent en mémoire ; elles ne sont persistées qu'à la fin (résultat, stats). Pas de replay complet en v1 (stocker le log d'événements en jsonb si on veut le replay plus tard — prévoir le champ dès v1, cheap).

---

## 4. API REST

| Route | Méthode | Description |
|---|---|---|
| `/api/auth/guest` | POST | Crée une session invité {pseudo} → tokens bearer |
| `/api/auth/register` / `/login` / `/logout` | POST | Comptes |
| `/api/me` | GET | Profil + stats |
| `/api/games` | GET | Lobby : tables publiques `waiting`/`playing` |
| `/api/games` | POST | Créer une table (options) → `{code, joinUrl}` |
| `/api/games/{code}` | GET | État public de la salle |
| `/api/matchmaking/join` `/leave` | POST/DELETE | File partie rapide |
| `/ws` | GET upgrade | WebSocket (auth : token bearer en `Authorization` ou subprotocol) |

Le reste du gameplay passe **exclusivement par WebSocket** (pas de REST en partie → ordre garanti).

---

## 5. Protocole WebSocket

Messages JSON `{ "type": "...", "seq": n, "payload": {...} }`. `seq` côté serveur par partie pour la resynchronisation.

### 5.1 Client → Serveur

| `type` | Payload | Notes |
|---|---|---|
| `join_game` | `{code}` | via code/lien/lobby/matchmaking |
| `leave_game` | `{}` | abandon / quitter salle |
| `set_ready` | `{ready}` | salle d'attente |
| `update_options` | `{options}` | créateur uniquement |
| `add_bot` / `remove_bot` / `kick` | `{slot}` | créateur uniquement |
| `bid` | `{qty, value}` | value 1 = Paco |
| `dudo` | `{}` | |
| `calza` | `{}` | |
| `god_action` | `{action, seat?, dice?}` | actions : `set_dice`, `force_resolve`, `kick`, `end_game` — privilège vérifié serveur (admin ou mode dieu de table) |
| `chat` | `{text}` ou `{emote}` | |
| `ping` | `{}` | keepalive app-level |

### 5.2 Serveur → Client

| `type` | Diffusion | Payload |
|---|---|---|
| `lobby_state` | salle | joueurs, options, prêts |
| `game_started` | salle | seats, options figées |
| `round_started` | partie | `{round, yourDice:[...], diceCounts:{seat:n}}` — **yourDice filtré par destinataire** |
| `bid_placed` | partie | `{seat, qty, value}` |
| `dudo_called` / `calza_called` | partie | `{seat}` |
| `reveal` | partie | `{allDice:{seat:[...]}, matched:n, loser:seat, remaining:n}` |
| `player_eliminated` | partie | `{seat, finalRank}` |
| `game_ended` | partie | classement + stats |
| `turn` | partie | `{seat, deadline}` |
| `player_disconnected` / `player_reconnected` | partie | `{seat, graceDeadline}` |
| `god_state` | destinataires god | `{allDice:{seat:[...]}}` — flux continu ; le destinataire god reçoit les dés de tous |
| `god_powers` | destinataire | pouvoirs disponibles selon rôle (admin / mode dieu) et options |
| `chat` | salle/partie | `{from, text/emote}` |
| `error` | destinataire | `{code, message}` |
| `resync` | destinataire | snapshot complet (reconnexion) |

### 5.3 Règles protocole

- Actions hors tour → `error` + ignorées.
- Le client n'a **jamais** accès aux dés adverses (filtre à l'émission, pas au rendu — anti-triche structurelle) **sauf** destinataires god (admin ou table en mode dieu) qui reçoivent `god_state`.
- Spectateurs : même flux mais `yourDice` vide ; `reveal` inclut les dés (révélation publique). Un spectateur admin reçoit `god_state`.
- Reconnexion : le client envoie son token + `lastSeq` ; le serveur renvoie `resync` (snapshot) ou les événements manqués si buffer < 90 s.

---

## 6. Frontend

### 6.1 Structure (monorepo)

```
doodo/
  apps/
    mobile/            # Expo app (iOS/Android — cible principale)
      app/             # Expo Router : Home, Lobby, Room, Game, Results, Profile, Login
      src/
        scenes/        # TableScene (R3F) : table, gobelets, dés, avatars, caméra 1ʳᵉ pers.
        ui/            # HUD : BidSelector, Timer, Chat, Emotes, menus (composants RN)
        assets/        # modèles glTF (dés, gobelets, table, avatars low-poly), textures, sons
  packages/
    shared/            # TS : types du protocole WS, client WS (reconnect/resync),
                       # store zustand, i18n (fr.json, structure prête pour en)
  server/              # backend Go (§7)
```

### 6.2 Scène 3D (natif)

- **Composition** : un `<Canvas>` R3F (backé par `expo-gl`) pour la table — caméra fixe à la première personne depuis le siège du joueur ; HUD en composants RN par-dessus. Séparation nette : la scène lit le store zustand, elle ne parle jamais au réseau.
- **Contraintes RN/R3F** : pas de DOM à l'intérieur du canvas → les helpers `drei` dépendant du DOM (`Html`, `Billboard` texte…) sont remplacés par des overlays RN ou `drei`'s `Text`/`Text3D`. Les assets glTF se chargent via `expo-asset` + metro ; prévoir un loader dédié (`useGLTF` configuré pour les assets embarqués).
- **Style** : low-poly stylisé — cible 60 fps sur smartphone milieu de gamme. Techniques : instancing des dés, DPR plafonné (≤ 2), meshes optimisés (draco) via `gltf-transform`.
- **Animations** : scripted (lerp/easing en `useFrame`, ou `@react-spring/three`) — gobelet levé, dés qui roulent, révélation ; pas de moteur physique complet en v1.
- **Assets** : modèles glTF faits maison (Blender) ou packs low-poly licence CC0/commerciale — à sourcer en début de dev. **Embarqués dans le bundle app** (pas de CDN requis pour jouer).
- **Fallback** : qualité auto-dégradée si fps bas (ombres off, DPR réduit) ; un vrai mode 2D est envisageable mais pas requis en v1.

### 6.3 Points d'attention

- **Client WS résilient** : backoff exponentiel, file des actions utilisateur pendant la déco (ou blocage UI explicite), resync via `lastSeq`. `WebSocket` existe à l'identique sur RN — même code partout.
- **Mobile-first** : tap targets ≥ 44 px, gestion du `SafeArea`, clavier logiciel (chat), retour haptique léger sur les actions (nice to have).
- **Web ultérieur** : `react-native-web` + build statique si une version navigateur devient souhaitable — `packages/shared` et la majorité des écrans sont réutilisables ; la scène 3D tourne alors dans le R3F web standard.
- **Builds & distribution** :
  - **Tests Android (v1)** : workflow GitHub Actions qui build l'APK (`expo prebuild` + `gradlew assembleRelease`) et l'attache à une **GitHub Release** — téléchargement direct sur téléphone (« installer des applis inconnues » à autoriser une fois). APK debug en artifact CI à chaque push sur `main`.
  - **Signature** : keystore de release généré une fois, stocké en base64 dans les secrets GitHub ; signature debug acceptable pour les builds de test interne.
  - **Stores (ultérieur)** : EAS Build pour iOS/Android store-ready, publication Play Store + App Store, OTA updates via EAS Update pour le JS (corrections rapides sans review store).
- **Audio** : `expo-av` (ou `expo-audio`), SFX embarqués en assets. Un `AudioManager` mappe les événements du store → sons (dés, gobelet, dudo, calza, révélation, élimination, victoire, notification de tour), avec réglage volume/mute persisté et ducking du son système.
- **God mode UI** : overlay admin flottant (dés de chacun, édition de tirage, actions forcées) visible seulement si `god_powers` le permet ; en mode dieu de table : écran de sélection de dés au lancer de manche + dés adverses rendus dans la scène 3D ; badge « Mode dieu » affiché dans la salle et en jeu.

---

## 7. Moteur de jeu (Go)

```
internal/
  game/        # règles pures : Bid.IsValid(), Resolve(dudo|calza), palifico
               # → package sans IO, 100% testé unitairement
  actor/       # GameActor : boucle événements, timers, goroutine par partie
  hub/         # registry parties + clients, routage WS
  bot/         # moteur bots (même interface qu'un client, latence simulée)
  matchmaking/ # file FIFO, constitution des tables
  api/         # handlers REST
  ws/          # handlers WS, sérialisation protocole
  store/       # sqlc/pgx : users, games, stats
```

**Séparation stricte :** `internal/game` = logique pure (aucun dé, aucun réseau) → tests exhaustifs des règles, y compris les cas limites de la spec fonc. §1.4. Le RNG (`math/rand/v2`, seed crypto) vit dans l'acteur.

**Bots « normal » v1 :** pour chaque décision, calcul de P(enchère vraie) via dénombrement binomial conditionné aux dés propres (+ Pacos). Surenchère agressive quand P élevée, Dudo sous un seuil, Calza quand le mode de la distribution ≈ enchère exacte. Latence 1-3 s + jitter.

**Moteur de règles modulaire (règles personnalisées) :** `RuleSet` = config sérialisable stockée dans `games.options.customRules[]`. Chaque règle perso est un module Go enregistré dans un registry, implémentant des hooks optionnels — `ValidateBid`, `CountDice`, `OnReveal`, `OnRoundEnd`, `RankedSafe`… — appliqués par le pipeline de l'acteur dans un ordre déclaré. Ajouter une règle = un fichier + un enregistrement, sans toucher à la machine à états. La matrice de compatibilité est déclarative (règle ↔ règle, règle ↔ option officielle) et validée à la création de table.

**God mode :** l'acteur reconnaît deux privilèges — `admin` (flag `users.is_admin`) et `godMode` (option de table). Il élargit le filtre de diffusion (`god_state` vers les destinataires god) et accepte les `god_action` correspondantes après vérification du privilège à chaque message. En mode dieu de table, l'étape `ROUND_ROLL` attend un `god_action set_dice` par joueur au lieu de tirer au hasard (fallback auto après timeout). Toutes les actions god sont écrites dans le log d'événements de la partie.

---

## 8. Sécurité & fiabilité

- **Serveur autoritaire** : aucune donnée secrète jamais émise à un client non autorisé ; validation de chaque action (tour, légalité de l'enchère, options de table).
- **Auth** : bcrypt pour les mots de passe ; JWT courts signés + refresh tokens rotatifs ; côté web un cookie `httpOnly, Secure, SameSite=Lax` peut porter le token, côté natif `expo-secure-store`.
- **Rate limiting** : par IP sur les endpoints auth + global sur les messages WS/chat (anti-spam, ex. 10 msg/10 s).
- **Validation stricte** des payloads WS (JSON schema léger ou décodage typé + checks).
- **Anti double-jeu** : une session = une connexion active par partie ; nouvelle connexion kick l'ancienne (ou reconnexion contrôlée).
- **God mode contrôlé** : privilège vérifié côté serveur sur **chaque** `god_action` (jamais de confiance au client) ; mode dieu refusé en matchmaking, lobby public et partie classée ; toutes les actions god dans le log d'événements (audit + futur replay).
- **Timers** gérés dans l'acteur (pas de timer client fiable) ; horodatage serveur, deadline transmise aux clients pour l'affichage.
- **Persistance** : aucune partie en cours en BDD → crash serveur = parties perdues (accepté en v1 ; log + métrique). Un mécanisme de snapshot mémoire→redis est envisageable v2.

---

## 9. Déploiement (VPS / Docker)

```yaml
# docker-compose.yml (v1)
services:
  app:        # image Go multi-stage (builder → scratch/distroless)
    ports: [ "8080:8080" ]      # derrière Caddy
    env: DATABASE_URL, JWT_SECRET
  db:
    image: postgres:17
    volumes: [ pgdata ]
  caddy:
    image: caddy:2              # TLS auto, reverse proxy /api + /ws + static
```

- Le backend reste hébergé seul ; les apps mobiles sont construites via **EAS Build** (Hors docker-compose — builds gérés côté Expo ou en self-hosted).
- Migrations : `goose` ou `golang-migrate` au démarrage du conteneur app.
- Métriques minimales : `/healthz`, compteurs parties actives/connexions WS (endpoint admin protégé ou expvar).
- **Scaling futur** (documenté, non implémenté) : sticky sessions + Redis pub/sub pour le broadcast cross-node, ou shard des parties par nœud via un routeur de codes.

---

## 10. Tests & qualité

| Niveau | Outil | Cible |
|---|---|---|
| Règles pures | `go test` + table-driven + propriétés (rapid/gopter) | `internal/game` ~100 %, tous les cas §1.4 spec fonc. + chaque règle perso et ses combinaisons compatibles |
| Acteur/partie | tests goroutines, fake clock | déroulement complet, timers, reconnexion |
| API/WS | `httptest` + client WS | flows join→bid→dudo |
| Bots | parties bot-vs-bot en boucle (soak) | pas de deadlock, distribution des durées |
| Front | Vitest (shared/store) + Maestro e2e (émulateur/device) | parcours invité → partie 2 joueurs (dont bots) |
| CI | GitHub Actions : lint (`golangci-lint`, eslint), tests, build docker | gate PR |

---

## 11. Décisions structurantes récapitulées

1. Serveur Go mono-process autoritaire, état des parties en mémoire, goroutine-acteur par partie.
2. Frontend Expo/React Native (iOS/Android en v1) + R3F/`expo-gl` pour la 3D, en monorepo avec `packages/shared`.
3. Protocole WS JSON avec filtrage des secrets à l'émission et resync par séquence.
4. PostgreSQL pour comptes/stats/résultats uniquement.
5. Règles dans un package pur fortement testé — indépendant du réseau.
6. V2 préparée (champs ELO/amis/log d'événements, i18n) sans être implémentée.
