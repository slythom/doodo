import { HTTP_URL } from '@/config';
import type { TableOptions } from '@doodo/shared';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; isGuest: boolean; isAdmin: boolean; gamesPlayed: number; gamesWon: number };
}

export interface RoomInfo {
  code: string;
  players: number;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  options: TableOptions;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${HTTP_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.code ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  guest: (username: string) =>
    post<AuthResponse>('/api/auth/guest', { username }),
  register: (username: string, email: string, password: string) =>
    post<AuthResponse>('/api/auth/register', { username, email, password }),
  login: (login: string, password: string) =>
    post<AuthResponse>('/api/auth/login', { login, password }),
  refresh: (refreshToken: string) =>
    post<AuthResponse>('/api/auth/refresh', { refreshToken }),
  createGame: (options: TableOptions, isPublic: boolean) =>
    post<{ code: string; joinUrl: string }>('/api/games', { options, public: isPublic }),
  listGames: async (): Promise<RoomInfo[]> => {
    const res = await fetch(`${HTTP_URL}/api/games`);
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  },
};
