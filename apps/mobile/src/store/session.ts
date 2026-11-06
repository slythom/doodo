import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const KEYS = { clientId: 'doodo.clientId', username: 'doodo.username', muted: 'doodo.muted' };
const TOKENS = { access: 'doodo.access', refresh: 'doodo.refresh' };

interface SessionState {
  clientId: string;
  username: string;
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  isAdmin: boolean;
  muted: boolean;
  hydrated: boolean;
  setUsername: (u: string) => void;
  setTokens: (access: string, refresh: string, userId: string, isAdmin: boolean) => void;
  setMuted: (m: boolean) => void;
  hydrate: () => Promise<void>;
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16));
}

export const useSession = create<SessionState>((set, get) => ({
  clientId: '',
  username: '',
  accessToken: null,
  refreshToken: null,
  userId: null,
  isAdmin: false,
  muted: false,
  hydrated: false,

  setUsername: (username) => {
    set({ username });
    void AsyncStorage.setItem(KEYS.username, username);
  },

  setTokens: (accessToken, refreshToken, userId, isAdmin) => {
    set({ accessToken, refreshToken, userId, isAdmin });
    void SecureStore.setItemAsync(TOKENS.access, accessToken);
    void SecureStore.setItemAsync(TOKENS.refresh, refreshToken);
  },

  setMuted: (muted) => {
    set({ muted });
    void AsyncStorage.setItem(KEYS.muted, muted ? '1' : '0');
  },

  hydrate: async () => {
    if (get().hydrated) return;
    let [clientId, username, muted, access, refresh] = await Promise.all([
      AsyncStorage.getItem(KEYS.clientId),
      AsyncStorage.getItem(KEYS.username),
      AsyncStorage.getItem(KEYS.muted),
      SecureStore.getItemAsync(TOKENS.access).catch(() => null),
      SecureStore.getItemAsync(TOKENS.refresh).catch(() => null),
    ]);
    if (!clientId) {
      clientId = uuid();
      void AsyncStorage.setItem(KEYS.clientId, clientId);
    }
    set({
      clientId,
      username: username ?? '',
      muted: muted === '1',
      accessToken: access,
      refreshToken: refresh,
      hydrated: true,
    });
  },
}));
