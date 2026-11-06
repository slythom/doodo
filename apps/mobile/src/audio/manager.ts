import { Audio } from 'expo-av';
import { useSession } from '@/store/session';

/** Mapping événement de jeu → asset audio (spec §4.3). */
const SOUNDS: Record<string, any> = {
  round_started: require('../../assets/sounds/dice_roll.wav'),
  bid_placed: require('../../assets/sounds/cup_down.wav'),
  dudo_called: require('../../assets/sounds/dudo.wav'),
  calza_called: require('../../assets/sounds/calza.wav'),
  reveal: require('../../assets/sounds/reveal.wav'),
  player_eliminated: require('../../assets/sounds/eliminated.wav'),
  game_ended: require('../../assets/sounds/victory.wav'),
  turn: require('../../assets/sounds/turn.wav'),
};

const cache = new Map<string, Audio.Sound>();

export async function playEvent(type: string): Promise<void> {
  if (useSession.getState().muted) return;
  const asset = SOUNDS[type];
  if (!asset) return;
  try {
    let sound = cache.get(type);
    if (!sound) {
      const res = await Audio.Sound.createAsync(asset, { shouldPlay: false, volume: 0.8 });
      sound = res.sound;
      cache.set(type, sound);
    }
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // audio non dispo — silencieux
  }
}

export async function unloadAll(): Promise<void> {
  for (const s of cache.values()) {
    await s.unloadAsync().catch(() => {});
  }
  cache.clear();
}
