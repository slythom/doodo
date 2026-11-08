import '@/polyfills';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox, Sparkles, useGLTF } from '@react-three/drei';
import { Asset } from 'expo-asset';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  DataTexture,
  LoopOnce,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type Group,
  type Object3D,
} from 'three';
import { SkeletonUtils } from 'three-stdlib';
import type { DieValue, PlayerInfo } from '@doodo/shared';

export interface SceneProps {
  players: PlayerInfo[];
  diceCounts: Record<number, number>;
  mySeat: number | null;
  yourDice?: DieValue[];   // conservé pour usage futur
  godDice: Record<number, DieValue[]> | null;
  turnSeat: number | null;
  round?: number;
  /** Dernier projectile reçu du serveur (null si aucun). */
  thrown?: { item: string; fromSeat: number; seat: number; at: number } | null;
  /** Tap sur un gobelet adverse → lancer d'objet. */
  onThrow?: (seat: number) => void;
}

const TABLE_RADIUS = 2.6;
const CUP_DIST = TABLE_RADIUS - 0.7;

const SKIN_TONES = ['#f2c9a0', '#e0ac69', '#c68642', '#8d5524', '#a8764f', '#5c3a21'];

const AVATARS: string[] = [
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Casual_Male.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Casual_Female.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Casual2_Male.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Casual3_Male.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Casual_Bald.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Cowboy_Male.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Pirate_Female.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Worker_Male.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Suit_Female.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_OldClassy_Female.glb')).uri,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Asset.fromModule(require('../../assets/models/avatar_Viking_Male.glb')).uri,
];

AVATARS.forEach((u) => useGLTF.preload(u));

/** Avatar assis derrière un gobelet, tourné vers le centre de la table. */
function Avatar({ index, total, variant, hitAt }: { index: number; total: number; variant: number; hitAt: number }) {
  const { scene, animations } = useGLTF(AVATARS[variant % AVATARS.length]);
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    // Le matériau 'Skin' du pack est quasi noir par défaut — on le remplace
    // par une teinte de peau qui varie par siège.
    c.traverse((o) => {
      const m = (o as { material?: { name?: string; color?: { set: (v: string) => void }; roughness?: number; metalness?: number } }).material;
      if (m?.name === 'Skin' && m.color?.set) {
        m.color.set(SKIN_TONES[variant % SKIN_TONES.length]);
        m.roughness = 0.85; // rendu mat, sans reflets plastique
        m.metalness = 0;
      }
    });
    return c;
  }, [scene, variant]);
  const mixer = useMemo(() => new AnimationMixer(clone), [clone]);
  const ref = useRef<Object3D>(null);
  const angle = cupAngle(index, total);
  const r = CUP_DIST + 0.72;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  useEffect(() => {
    ref.current?.lookAt(0, 0.5, 0); // +Z du modèle vers le centre
    const idle = AnimationClip.findByName(animations, 'Idle') ?? animations[0];
    if (idle) {
      mixer.clipAction(idle).play(); // boucle infinie par défaut
    }
    return () => { mixer.stopAllAction(); };
  }, [animations, mixer]);
  // Coup reçu : RecieveHit une fois, puis Idle reprend.
  useEffect(() => {
    if (!hitAt) return;
    const hit = AnimationClip.findByName(animations, 'RecieveHit');
    const idle = AnimationClip.findByName(animations, 'Idle');
    if (!hit || !idle) return;
    const action = mixer.clipAction(hit);
    const back = mixer.clipAction(idle);
    action.reset().setLoop(LoopOnce, 1).fadeIn(0.1).play();
    const onFinished = (e: { action: AnimationAction }) => {
      if (e.action === action) {
        back.reset().fadeIn(0.3).play();
        mixer.removeEventListener('finished', onFinished);
      }
    };
    mixer.addEventListener('finished', onFinished);
    return () => {
      mixer.removeEventListener('finished', onFinished);
      action.fadeOut(0.1);
    };
  }, [hitAt, animations, mixer]);
  useFrame((_s, dt) => mixer.update(dt));
  return (
    <primitive
      ref={ref}
      object={clone}
      position={[x, -0.55, z]}
      scale={0.62}
    />
  );
}

/** Angle du i-ème gobelet adverse en éventail (partagé 3D ↔ overlay HUD). */
export function cupAngle(index: number, total: number): number {
  return Math.PI * 1.15 + (index * Math.PI) / Math.max(total - 1, 1);
}

/** Position écran horizontale approximative (0..1) d'un gobelet — caméra fixe. */
export function cupScreenX(index: number, total: number): number {
  return 0.5 + Math.cos(cupAngle(index, total)) * CUP_DIST * 0.235;
}

/** Position écran verticale (0..1) : plus le gobelet est loin (z<0), plus il monte. */
export function cupScreenY(index: number, total: number): number {
  const z = Math.sin(cupAngle(index, total)) * CUP_DIST;
  return 0.41 + z * 0.045;
}

const CUP_COLORS = ['#a86f3d', '#8a5a2b', '#9c6b4a', '#7a4f2e', '#b07840', '#6e4a30'];

/** Profil tourné d'un gobelet en bois (au units) : ventre arrondi, col, lèvre. */
const cupProfile = (
  [
    [0.285, 0.00],
    [0.348, 0.03],
    [0.372, 0.15],
    [0.345, 0.30],
    [0.312, 0.38],
    [0.326, 0.46],
    [0.343, 0.52],
    [0.328, 0.555], // lèvre extérieure
    [0.310, 0.565], // dessus de lèvre
    [0.300, 0.51],  // paroi interne
    [0.262, 0.42],  // fond interne
    [0.001, 0.405],
  ] as [number, number][]
).map(([r, y]) => new Vector2(r, y));

/**
 * Filigrane procédural pour le feutre de la table (grain fin).
 * DataTexture : le seul type de texture réalisable sur canvas natif (pas de 2D canvas RN).
 */
function makeFeltTextures(baseHex: string, variance = 14) {
  const n = 64;
  const base = {
    r: parseInt(baseHex.slice(1, 3), 16),
    g: parseInt(baseHex.slice(3, 5), 16),
    b: parseInt(baseHex.slice(5, 7), 16),
  };
  const build = () => {
    const data = new Uint8Array(n * n * 4);
    let seed = 0x1234abcd;
    const rand = () => { // xorshift déterministe
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) % 1000) / 1000;
    };
    for (let i = 0; i < n * n; i++) {
      const d = (rand() - 0.5) * 2 * variance;
      data[i * 4 + 0] = Math.max(0, Math.min(255, base.r + d));
      data[i * 4 + 1] = Math.max(0, Math.min(255, base.g + d));
      data[i * 4 + 2] = Math.max(0, Math.min(255, base.b + d));
      data[i * 4 + 3] = 255;
    }
    const t = new DataTexture(data, n, n);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(6, 6);
    t.needsUpdate = true;
    return t;
  };
  const map = build();
  map.colorSpace = SRGBColorSpace; // albedo
  const bump = build(); // bumped reste en linéaire
  return { map, bump };
}

// Gobelet d'un adversaire + sa pile de dés (compte) ou ses dés révélés (god).
function OpponentCup({ index, total, count, isTurn, godDice, seat, onTap }: {
  index: number; total: number; count: number; isTurn: boolean; godDice?: DieValue[]; seat: number;
  onTap?: () => void;
}) {
  // Éventail autour de la table, face à la caméra (le joueur est au sud).
  const angle = cupAngle(index, total);
  const x = Math.cos(angle) * CUP_DIST;
  const z = Math.sin(angle) * CUP_DIST;
  const cup = useRef<Group>(null);
  const rim = useRef<Object3D>(null);
  useFrame((s) => {
    if (cup.current && isTurn) {
      cup.current.position.y = 0.32 + Math.sin(s.clock.elapsedTime * 4) * 0.03;
      cup.current.rotation.z = Math.sin(s.clock.elapsedTime * 2.3) * 0.05; // frémissement d'attente
    }
    // Anneau doré pulsant quand c'est le tour de ce siège.
    if (rim.current) {
      const m = (rim.current as unknown as { material?: { emissiveIntensity?: number } }).material;
      if (m?.emissiveIntensity !== undefined) {
        m.emissiveIntensity = isTurn ? 0.6 + Math.sin(s.clock.elapsedTime * 4) * 0.35 : 0.06;
      }
    }
  });
  const wood = CUP_COLORS[seat % CUP_COLORS.length];
  return (
    <group position={[x, 0, z]}>
      <group ref={cup} position={[0, 0.32, 0]}>
        {/* corps tourné, ombrage lisse + liseré doré */}
        <mesh castShadow onClick={onTap} onPointerDown={onTap}>
          <latheGeometry args={[cupProfile, 26]} />
          <meshStandardMaterial color={wood} roughness={0.75} metalness={0.04} />
        </mesh>
        <mesh ref={rim} position={[0, 0.545, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.33, 0.014, 8, 26]} />
          <meshStandardMaterial
            color={isTurn ? '#e8b74a' : '#c8b088'}
            emissive="#e8b74a"
            emissiveIntensity={0.06}
            roughness={0.35}
            metalness={0.85}
          />
        </mesh>
      </group>
      {godDice && godDice.length > 0 && <RevealDice angle={angle} dice={godDice} />}
    </group>
  );
}

/**
 * Dés révélés (mode divin) alignés devant le gobelet, valeur au-dessus.
 * Dé disposé normalement (cube arrondi) : pacs symbolisés par un pion doré.
 */
const DIE_SIZE = 0.15;
function pipOffsets(value: DieValue): [number, number][] {
  // Grille 3×3 sur la face supérieure (-même map que le HUD 2D).
  const P: Record<number, number[]> = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };
  const cells = P[Math.min(6, Math.max(1, value))] ?? [];
  const step = DIE_SIZE * 0.30;
  return cells.map((c) => [((c % 3) - 1) * step, (Math.floor(c / 3) - 1) * step]);
}

function RevealDice({ angle, dice }: { angle: number; dice: DieValue[] }) {
  const dirX = -Math.cos(angle), dirZ = -Math.sin(angle); // vers le centre
  const perpX = -dirZ, perpZ = dirX;
  const n = Math.min(dice.length, 5);
  return (
    <group>
      {Array.from({ length: n }, (_, i) => {
        const v = dice[i];
        const lateral = (i - (n - 1) / 2) * (DIE_SIZE + 0.035);
        const depth = 0.45 + (i % 2) * 0.05; // léger décalage en profondeur
        const px = dirX * depth + perpX * lateral;
        const pz = dirZ * depth + perpZ * lateral;
        const paco = v === 1;
        return (
          <group key={i} position={[px, DIE_SIZE / 2, pz]} rotation={[0, angle + i * 0.42, 0]}>
            <RoundedBox args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]} radius={0.02} smoothness={3} castShadow>
              <meshStandardMaterial color={paco ? '#20343a' : '#e8e2d4'} roughness={0.4} />
            </RoundedBox>
            {picoPips(v, paco)}
          </group>
        );
      })}
    </group>
  );
}

function picoPips(v: DieValue, paco: boolean) {
  const color = paco ? '#f2c14e' : '#2b2620';
  const r = paco ? 0.028 : 0.02;
  return pipOffsets(v).map(([ox, oz], i) => (
    <mesh key={i} position={[ox, DIE_SIZE / 2 + 0.001, oz]}>
      <sphereGeometry args={[r, 8, 6]} />
      <meshStandardMaterial color={color} roughness={0.5} />
    </mesh>
  ));
}

// Suspension stylisée : abat-jour + ampoule chaude au-dessus de la table + poussière lumineuse.
function Suspension() {
  return (
    <group position={[0, 4.2, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.8, 6]} />
        <meshStandardMaterial color="#241a12" />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <coneGeometry args={[0.7, 0.5, 12, 1, true]} />
        <meshStandardMaterial color="#c8955c" flatShading side={2} />
      </mesh>
      <pointLight position={[0, -0.15, 0]} intensity={16} distance={10} color="#ffc98a" decay={2} />
      <Sparkles count={24} scale={[3.2, 2.2, 3.2]} position={[0, -0.6, 0]} size={1.4} speed={0.12} opacity={0.45} color="#ffdda6" />
    </group>
  );
}

// Tomate lancée : arc parabolique vers le gobelet de la cible, puis "splat" + éclaboussure.
function Tomato({ targetIndex, targetTotal, done }: { targetIndex: number; targetTotal: number; done: () => void }) {
  const g = useRef<Group>(null);
  const t = useRef(0);
  const splat = useRef(false);
  // Phase splat portée en state: force le re-render qui affiche décalque + éclaboussure.
  const [splatting, setSplatting] = useState(false);
  const angle = cupAngle(targetIndex, targetTotal);
  const r = CUP_DIST + 0.72; // rayon des avatars
  const tx = Math.cos(angle) * r;
  const tz = Math.sin(angle) * r;
  const headY = 0.78;      // dessus de tête — visible au-dessus du gobelet
  useFrame((_s, dt) => {
    t.current += dt * 1.4;
    if (!g.current) return;
    if (!splat.current && t.current >= 1) {
      splat.current = true;
      setSplatting(true);
      setTimeout(done, 400);
    }
    if (splat.current) {
      // écrasement au sol sur le point d'impact
      g.current.scale.set(2.4, 0.12, 2.4);
      g.current.position.set(tx, 0.02, tz);
      return;
    }
    const k = t.current;
    g.current.position.set(
      k * tx,
      0.9 + Math.sin(k * Math.PI) * 1.9 + (headY - 0.9) * k, // arc → retombe sur la tête
      3.4 + k * (tz - 3.4),
    );
    g.current.rotation.x = k * 9;
    g.current.rotation.z = k * 7;
  });
  return (
    <>
      <group ref={g} position={[0, 0.9, 3.4]}>
        <mesh castShadow>
          <sphereGeometry args={[0.2, 14, 12]} />
          <meshStandardMaterial color="#c2352a" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.13, 0]}>
          <coneGeometry args={[0.07, 0.1, 6]} />
          <meshStandardMaterial color="#3d6b4f" flatShading />
        </mesh>
      </group>
      {splatting && (
        <>
          {/* trace de sauce sur la table, au point d'impact */}
          <mesh position={[tx, 0.01, tz]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.42, 20]} />
            <meshStandardMaterial color="#6e1811" roughness={0.9} transparent opacity={0.65} />
          </mesh>
          {/* gouttelettes d'impact */}
          <Sparkles count={16} scale={[0.7, 0.35, 0.7]} position={[tx, 0.1, tz]} size={2.2} speed={1.4} color="#e04b3a" />
        </>
      )}
    </>
  );
}

function Table() {
  const felt = useMemo(() => makeFeltTextures('#2e5d43', 16), []);
  return (
    <group>
      {/* feutre texturé */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.1, 40]} />
        <meshStandardMaterial map={felt.map} bumpMap={felt.bump} bumpScale={0.35} roughness={0.95} color="#ffffff" />
      </mesh>
      {/* liseré bois du plateau */}
      <mesh position={[0, -0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TABLE_RADIUS + 0.02, 0.055, 10, 48]} />
        <meshStandardMaterial color="#5a3a20" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.18, 0.3, 1.1, 10]} />
        <meshStandardMaterial color="#5a3a20" flatShading />
      </mesh>
      <mesh position={[0, -1.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#241a12" />
      </mesh>
    </group>
  );
}

export function TableScene({ players, diceCounts, mySeat, godDice, turnSeat, thrown, onThrow }: SceneProps) {
  const [tomatoDone, setTomatoDone] = useState(0);
  const opponents = players.filter((p) => p.seat !== mySeat && p.seat < 100);
  return (
    <Canvas
      style={styles.canvas}
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 5.2, 8.6], fov: 58, near: 0.1, far: 60 }}
      onCreated={({ camera }) => camera.lookAt(0, -0.5, 0)}
    >
      <color attach="background" args={['#171008']} />
      <fog attach="fog" args={['#171008', 9, 20]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[3, 6, 4]} intensity={1.6} color="#ffe6c4" castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002} shadow-normalBias={0.02}
      />
      <directionalLight position={[0, 3, 8]} intensity={0.45} color="#9db6ff" />  {/* fill frontal froid */}
      <directionalLight position={[-4, 3, -2]} intensity={0.55} color="#ff9b4a" /> {/* rim chaud arrière-gauche */}
      <hemisphereLight args={['#f5e6c8', '#241a12', 0.35]} />
      <Suspension />
      <Table />
      {opponents.map((p, i) => (
        <OpponentCup
          key={p.seat}
          index={i}
          total={opponents.length}
          count={diceCounts[p.seat] ?? 0}
          isTurn={turnSeat === p.seat}
          godDice={godDice?.[p.seat]}
          seat={p.seat}
          onTap={onThrow ? () => onThrow(p.seat) : undefined}
        />
      ))}
      <Suspense fallback={null}>
        {opponents.map((p, i) => (
          <Avatar key={`av-${p.seat}`} index={i} total={opponents.length} variant={p.seat}
            hitAt={thrown?.seat === p.seat ? thrown.at : 0} />
        ))}
      </Suspense>
      {thrown?.item === 'tomato' && thrown.at !== tomatoDone && (() => {
        const ti = opponents.findIndex((p) => p.seat === thrown.seat);
        return ti >= 0 ? (
          <Tomato key={thrown.at} targetIndex={ti} targetTotal={opponents.length}
            done={() => setTomatoDone(thrown.at)} />
        ) : null;
      })()}
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
