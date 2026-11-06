# Doodo — Perudo en ligne

App mobile iOS/Android (Expo RN + React Three Fiber) + backend Go/WebSocket.
Specs : [`specs_fonctionnelles.md`](specs_fonctionnelles.md) · [`specs_techniques.md`](specs_techniques.md) · [`plan_implementation.md`](plan_implementation.md)

## Structure

```
apps/mobile      # app Expo (iOS/Android) — Expo Router, R3F/expo-gl, zustand
packages/shared  # types protocole WS, client WS résilient, store, i18n — partagé
server/          # backend Go (chi + coder/websocket) — autorité de jeu
```

## Prérequis

- Go ≥ 1.26
- Node ≥ 22 + pnpm 10 (`~/.local/bin` sur cette machine)
- Pour tester sur téléphone : Expo Go (expo-gl est inclus dans Expo Go) ou l'APK CI

## Dev

```bash
pnpm install                  # deps JS (monorepo)

# backend
cd server && go run ./cmd/doodo     # → http://localhost:8080 (GET /healthz, /ws)

# app mobile
cd apps/mobile && pnpm expo start   # scanner le QR avec Expo Go
```

## Tester sur téléphone Android

**Option A — Expo Go** (dev) : `pnpm expo start` dans `apps/mobile`, scanner le QR.
Le téléphone et la machine doivent être sur le même réseau.

**Option B — APK depuis GitHub** (test sans Metro) :
- Push sur `main` → workflow `android-apk` → artifact `doodo-debug-apk` dans l'onglet Actions.
- Créer une Release `v*` → APK signé attaché à la release, téléchargeable sur le tel
  (autoriser « installer des applis inconnues » une fois).

Secrets GitHub à créer pour la signature release :
```bash
keytool -genkeypair -v -keystore release.keystore -alias doodo \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore   # → secret ANDROID_KEYSTORE_BASE64
# + ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
```

⚠️ **Backend joignable** : l'app sur téléphone doit atteindre le serveur —
même Wi-Fi → `ws://<ip-locale>:8080/ws`, ou backend déployé sur le VPS.

## Checks

```bash
cd server && go test ./... && go vet ./...
pnpm -r run typecheck
pnpm -r --if-present run test
cd apps/mobile && npx expo lint && npx expo-doctor
```
