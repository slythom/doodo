import '@/polyfills';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import type { Group } from 'three';
import type { DieValue, PlayerInfo } from '@doodo/shared';

export interface SceneProps {
  players: PlayerInfo[];
  diceCounts: Record<number, number>;
  mySeat: number | null;
  yourDice: DieValue[];
  godDice: Record<number, DieValue[]> | null;
  turnSeat: number | null;
  round: number;
}

const TABLE_RADIUS = 2.6;
const CUP_DIST = TABLE_RADIUS - 0.7;

// Petit dé low-poly (cube blanc) — compte de dés, pas les valeurs.
function MiniDie({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} castShadow>
      <boxGeometry args={[0.12, 0.12, 0.12]} />
      <meshStandardMaterial color="#f5f0e6" flatShading />
    </mesh>
  );
}

// Gobelet d'un adversaire + sa pile de dés (compte) ou ses dés révélés (god).
function OpponentCup({ index, total, count, isTurn, godDice }: {
  index: number; total: number; count: number; isTurn: boolean; godDice?: DieValue[];
}) {
  // Éventail autour de la table, face à la caméra (le joueur est au sud).
  const angle = Math.PI * 1.15 + (index * Math.PI) / Math.max(total - 1, 1);
  const x = Math.cos(angle) * CUP_DIST;
  const z = Math.sin(angle) * CUP_DIST;
  const cup = useRef<Group>(null);
  useFrame((s) => {
    if (cup.current && isTurn) {
      cup.current.position.y = 0.28 + Math.sin(s.clock.elapsedTime * 4) * 0.03;
    }
  });
  return (
    <group position={[x, 0, z]}>
      <group ref={cup} position={[0, 0.28, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.22, 0.28, 0.45, 12]} />
          <meshStandardMaterial color={isTurn ? '#c8955c' : '#8a5a2b'} flatShading />
        </mesh>
      </group>
      {/* Compte de dés sous le gobelet (petits dés blancs) */}
      {godDice
        ? godDice.map((d, i) => (
            <mesh key={i} position={[-0.4 + i * 0.16, 0.08, 0.3]}>
              <boxGeometry args={[0.12, 0.12, 0.12]} />
              <meshStandardMaterial color={d === 1 ? '#e8b74a' : '#f5f0e6'} flatShading />
            </mesh>
          ))
        : Array.from({ length: count }, (_, i) => (
            <MiniDie key={i} position={[-0.4 + i * 0.16, 0.08, 0.3]} />
          ))}
    </group>
  );
}

// Dés du joueur devant la caméra — spin à chaque nouvelle manche.
function MyDice({ dice, round }: { dice: DieValue[]; round: number }) {
  const g = useRef<Group>(null);
  const spin = useRef(0);
  useFrame((s, dt) => {
    spin.current = Math.max(0, spin.current - dt * 2.5);
    if (g.current) g.current.rotation.x = spin.current * 6;
  });
  return (
    <group ref={g} position={[0, 0.35, 3.1]} key={round}>
      {dice.map((d, i) => (
        <mesh key={i} position={[-0.6 + i * 0.3, 0, 0]} castShadow>
          <boxGeometry args={[0.22, 0.22, 0.22]} />
          <meshStandardMaterial color={d === 1 ? '#e8b74a' : '#f5f0e6'} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Table() {
  return (
    <group>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.1, 24]} />
        <meshStandardMaterial color="#3d6b4f" flatShading />
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

export function TableScene({ players, diceCounts, mySeat, yourDice, godDice, turnSeat, round }: SceneProps) {
  const opponents = players.filter((p) => p.seat !== mySeat && p.seat < 100);
  return (
    <Canvas
      style={styles.canvas}
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 2.1, 4.2], fov: 55, near: 0.1, far: 60 }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <color attach="background" args={['#1a1410']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow />
      <Table />
      {opponents.map((p, i) => (
        <OpponentCup
          key={p.seat}
          index={i}
          total={opponents.length}
          count={diceCounts[p.seat] ?? 0}
          isTurn={turnSeat === p.seat}
          godDice={godDice?.[p.seat]}
        />
      ))}
      <MyDice dice={yourDice} round={round} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
