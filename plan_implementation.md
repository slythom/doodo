# Plan d'implémentation — Doodo (Perudo en ligne)

Document compagnon de `specs_fonctionnelles.md` et `specs_techniques.md`.
Découpage en phases ordonnées ; chaque phase se termine par un livrable vérifiable.
Complexité indicative : 🟢 faible · 🟡 moyenne · 🔴 élevée.

**Principe directeur** : backend + partie jouable en UI 2D d'abord, scène 3D ensuite — le client 2D et la scène 3D lisent le même store, donc la 3D arrive sans refactor. Exception : le **spike 3D** est volontairement en phase 0 pour dé-risquer `expo-gl`/R3F sur device.

---

## Phase 0 — Fondations & spike 3D

| # | Tâche | Cx |
|---|---|---|
| 0.1 | Monorepo : pnpm workspaces (+ Turborepo), `apps/mobile`, `packages/shared`, `server/` | 🟢 |
| 0.2 | `server/` : module Go (chi, coder/websocket, pgx, sqlc), `main` + `/healthz` | 🟢 |
| 0.3 | `docker-compose.yml` dev : postgres + app | 🟢 |
| 0.4 | `apps/mobile` : init Expo + Expo Router (TS strict), Zustand, i18n `fr.json` | 🟢 |
| 0.5 | `packages/shared` : squelette (client WS, types, store) — contrat des phases suivantes | 🟢 |
| 0.6 | **Spike 3D** 🔑 : `<Canvas>` R3F + `expo-gl` affichant dés + table low-poly sur **device réel** via EAS dev client. Go/no-go : 60 fps, assets glTF chargés | 🟡 |
| 0.7 | CI GitHub Actions : lint Go + TS, `go test`, vitest, build | 🟢 |
| 0.8 | Workflow APK : `expo prebuild` + `assembleDebug` → artifact CI téléchargeable (keystore release en secret GH dès le départ) | 🟡 |

**Livrable** : app Expo qui affiche un cube 3D sur un téléphone réel + backend Go qui répond sur `/healthz`, CI verte + **APK installable depuis GitHub**.

---

## Phase 1 — Moteur de règles (`internal/game`, pur, sans IO)

| # | Tâche | Cx |
|---|---|---|
| 1.1 | Types : `Bid`, `Die`, `RuleSet` (options officielles + `customRules[]`), état de manche | 🟢 |
| 1.2 | Règles officielles : validation d'enchères (quantité/valeur/Paco), résolution Dudo/Calza, perte/gain de dés, Palifico | 🔴 |
| 1.3 | Tous les cas limites spec fonc. §1.4 (Calza à dé max, égalités, Palifico unique…) | 🟡 |
| 1.4 | Registry de règles perso : interface à hooks (`ValidateBid`, `CountDice`, `OnReveal`, `OnRoundEnd`, `RankedSafe`), matrice de compatibilité déclarative | 🟡 |
| 1.5 | 1-2 règles perso pilotes pour valider l'architecture (ex. « Dé public », « Double Paco ») | 🟢 |
| 1.6 | Tests : table-driven ~100 % + propriétés (rapid/gopter) sur les enchères/résolutions | 🟡 |

**Livrable** : `internal/game` prouvé par tests — aucune ligne de réseau dans ce package.

---

## Phase 2 — Backend temps réel

| # | Tâche | Cx |
|---|---|---|
| 2.1 | Protocole WS : types Go + miroir TS dans `shared` (un seul schéma, généré ou maintenu) | 🟡 |
| 2.2 | Hub WS : connexions, routage par partie, broadcast filtré par destinataire | 🔴 |
| 2.3 | `GameActor` (1 goroutine/partie) : machine à états LOBBY→ROUND_ROLL→BIDDING→RESOLVING→ENDED | 🔴 |
| 2.4 | Timers de tour (dans l'acteur, deadline serveur + action auto) | 🟡 |
| 2.5 | Salles : création, code 6 car., join lien/code, prêts, kick, options figées au start | 🟡 |
| 2.6 | Lobby public : liste, bascule publique/privée, spectateurs | 🟡 |
| 2.7 | Bots niveau « normal » (binomial conditionné + jitter 1-3 s) + complétion de table | 🟡 |
| 2.8 | Matchmaking : file FIFO, constitution de table, fallback bots après 60 s | 🟡 |
| 2.9 | Reconnexion : `lastSeq`, buffer d'événements 90 s, `resync` snapshot | 🔴 |
| 2.10 | God mode serveur : privilèges admin/`godMode`, `god_state`, `god_action`, log d'événements | 🟡 |
| 2.11 | Soak test : parties bot-vs-bot en boucle (deadlocks, fuites, durées) | 🟢 |

**Livrable** : parties complètes jouables via un client WS de test (CLI/script) — humains + bots, reconnexion, god mode.

---

## Phase 3 — Auth & persistance

| # | Tâche | Cx |
|---|---|---|
| 3.1 | Schéma BDD (`users`, `games`, `game_players`) + migrations goose | 🟢 |
| 3.2 | Invités : `/api/auth/guest` → JWT + refresh ; jeton persisté côté app | 🟡 |
| 3.3 | Comptes : register/login (bcrypt), `is_admin` flag, `/api/me` + stats | 🟡 |
| 3.4 | Persistance fin de partie : résultats, `final_rank`, stats joueurs (parties/victoires) | 🟡 |
| 3.5 | Rate limiting (auth par IP, chat/messages WS par connexion) | 🟢 |

**Livrable** : compte créé → parties jouées → stats visibles via API.

---

## Phase 4 — App mobile : UI 2D complète

Le jeu est **entièrement jouable** à la fin de cette phase (UI fonctionnelle sans la scène 3D).

| # | Tâche | Cx |
|---|---|---|
| 4.1 | Client WS `shared` : auto-reconnect backoff, resync `lastSeq`, file d'actions | 🟡 |
| 4.2 | Écrans : Home (pseudo/login), Lobby, Room (attente, options, prêts, chat), Game, Results, Profile, Login | 🔴 |
| 4.3 | Écran Game 2D : dés propres, compteurs adverses, enchère courante, `BidSelector`, Dudo/Calza, timer | 🔴 |
| 4.4 | Chat + emotes, spectateur, indicateurs déco/reconnexion | 🟡 |
| 4.5 | God mode UI : panneau admin overlay + écran choix de dés (mode dieu) + badge | 🟡 |
| 4.6 | Réglages : volume/mute persisté ; `AudioManager` + SFX embarqués (mapping événements→sons) | 🟢 |
| 4.7 | Maestro e2e : parcours invité → partie 2 joueurs + bots | 🟡 |

**Livrable** : MVP jouable sur téléphone, publiable en beta interne.

---

## Phase 5 — Scène 3D

| # | Tâche | Cx |
|---|---|---|
| 5.1 | Sourcing assets glTF low-poly : dés (×6 faces ou 3D réels), gobelets, table, avatars — Blender ou packs CC0 | 🟡 |
| 5.2 | `TableScene` R3F/`expo-gl` : caméra 1ʳᵉ personne au siège du joueur, placement dynamique des sièges | 🔴 |
| 5.3 | Rendu état de jeu : gobelets adverses + compteurs de dés (texte 3D/overlay RN), dés propres visibles | 🟡 |
| 5.4 | Animations scripted (`useFrame`/springs) : lancer, gobelet levé, révélation, dé perdu | 🟡 |
| 5.5 | Mode dieu : dés adverses rendus dans la scène | 🟢 |
| 5.6 | Perfs : instancing dés, DPR ≤ 2, draco/KTX2, qualité dégradée auto si fps bas | 🟡 |
| 5.7 | Bascule HUD : la scène remplace le plateau de la phase 4.3, HUD RN conservé | 🟡 |

**Livrable** : partie jouable intégralement en vue 3D première personne, 60 fps sur smartphone milieu de gamme.

---

## Phase 6 — Production & publication

| # | Tâche | Cx |
|---|---|---|
| 6.1 | Backend prod : docker-compose VPS + Caddy TLS, migrations au boot, métriques `/healthz` | 🟡 |
| 6.2 | Builds : APK signé → **GitHub Releases** (canal de test principal Android) ; EAS Build pour iOS/store-ready ; icônes, splash, `app.json` stores-ready | 🟡 |
| 6.3 | Comptes Apple Developer / Play Console (à créer **tôt**, validations longues) | 🟢 |
| 6.4 | Beta : Play internal testing + TestFlight ; fiches stores (screenshots, description FR) | 🟡 |
| 6.5 | Durcissement : revue sécurité §8 spec tech, charge WS, test déco prolongée | 🟡 |

**Livrable** : v1 publiée sur les deux stores.

---

## Risques & points d'attention

| Risque | Mitigation |
|---|---|
| R3F/`expo-gl` perf ou compat sur device | **Spike phase 0.6** avant tout le reste du front |
| Complexité de la resync WS | Design `seq`+buffer dès 2.1 ; tests déco dès 2.9 |
| Explosion combinatoire règles perso | Matrice de compat déclarative (1.4) + `ranked_safe` par règle |
| Goulot assets 3D | Sourcing (5.1) peut démarrer **en parallèle** des phases 2-4 |
| Scope creep (ELO/amis/historique) | Strictement v2 — champs BDD prévus, rien d'implémenté |
| Abus god mode | Privilège revérifié à chaque message serveur ; audit log ; jamais en classé |

## Dépendances clés

```
0 (fondations+spike) ──┬──► 1 (règles) ──► 2 (temps réel) ──┬──► 3 (auth) ──► 4 (app 2D) ──► 5 (3D) ──► 6 (prod)
                       │                                    │
                       └──► sourcing assets 3D (parallèle) ──┘
```

- Le backend (phases 1-3) et l'app (phase 4) peuvent se chevaucher une fois `shared` figé (0.5 + 2.1).
- La 3D ne bloque rien : l'app 2D de la phase 4 est déjà un produit jouable.

---

## Backlog / notes

- **God mode réellement indétectable** : le flag `godMode` est encore présent dans
  `lobby_state`/`game_started` pour tous les clients — il n'est caché que côté UI
  (badge/panneau affichés uniquement aux détenteurs de `godPowers`). Pour le rendre
  invisible même à un client modifié, filtrer les options par destinataire côté
  serveur (payload par joueur, ou champ retiré pour les non-créateurs).
- Resync : le client n'applique pas encore le snapshot `resync` (store.ts, « phase 2 »)
  — y inclure `revealedDice`/`revealReady`/`call`/`resolution` quand il sera branché.
