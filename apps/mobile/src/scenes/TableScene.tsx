import '@/polyfills';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Asset } from 'expo-asset';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { AnimationAction, AnimationClip, AnimationMixer, LoopOnce } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import type { Group, Object3D } from 'three';
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
  Asset.fromModule(require('../../assets/models/avatar_Casual2_Female.glb')).uri,
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
      const m = (o as { material?: { name?: string; color?: { set: (v: string) => void } } }).material;
      if (m?.name === 'Skin' && m.color?.set) {
        m.color.set(SKIN_TONES[variant % SKIN_TONES.length]);
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
  useFrame((s) => {
    if (cup.current && isTurn) {
      cup.current.position.y = 0.32 + Math.sin(s.clock.elapsedTime * 4) * 0.03;
    }
  });
  return (
    <group position={[x, 0, z]}>
      <group ref={cup} position={[0, 0.32, 0]}>
        <mesh castShadow onClick={onTap} onPointerDown={onTap}>
          <cylinderGeometry args={[0.3, 0.38, 0.6, 12]} />
          <meshStandardMaterial color={isTurn ? '#e8b74a' : CUP_COLORS[seat % CUP_COLORS.length]} flatShading />
        </mesh>
      </group>

    </group>
  );
}

// Suspension stylisée : abat-jour + ampoule chaude au-dessus de la table.
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
      <pointLight position={[0, -0.15, 0]} intensity={14} distance={9} color="#ffc98a" decay={2} />
    </group>
  );
}

// Tomate lancée : arc parabolique vers le gobelet de la cible, puis "splat".
function Tomato({ targetIndex, targetTotal, done }: { targetIndex: number; targetTotal: number; done: () => void }) {
  const g = useRef<Group>(null);
  const t = useRef(0);
  const splat = useRef(false);
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
      setTimeout(done, 400);
    }
    if (splat.current) {
      // écrasement au sol
      g.current.scale.set(2.4, 0.12, 2.4);
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
    <group ref={g} position={[0, 0.9, 3.4]}>
      <mesh castShadow>
        <sphereGeometry args={[0.2, 10, 8]} />
        <meshStandardMaterial color="#c2352a" flatShading />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <coneGeometry args={[0.07, 0.1, 6]} />
        <meshStandardMaterial color="#3d6b4f" flatShading />
      </mesh>
    </group>
  );
}

function Table() {
  return (
    <group>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.1, 24]} />
        <meshStandardMaterial color="#2e5d43" flatShading />
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
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 6, 4]} intensity={1.4} castShadow />
      <directionalLight position={[0, 3, 8]} intensity={0.9} /> {/* fill frontal */}
      <hemisphereLight args={['#f5e6c8', '#241a12', 0.5]} />
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
