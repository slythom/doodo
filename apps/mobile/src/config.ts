// URL du backend. Pour tester sur téléphone en Wi-Fi local, définir
// EXPO_PUBLIC_SERVER_HOST=192.168.x.x dans un .env (expo le charge auto).
const host = process.env.EXPO_PUBLIC_SERVER_HOST ?? 'localhost';

export const HTTP_URL = `http://${host}:8080`;
export const WS_URL = `ws://${host}:8080/ws`;
