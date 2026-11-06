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
  yourDice?: DieValue[];   // conservé pour usage futur
  godDice: Record<number, DieValue[]> | null;
  turnSeat: number | null;
  round?: number;
}

const TABLE_RADIUS = 2.6;
const CUP_DIST = TABLE_RADIUS - 0.7;

/** Angle du i-ème gobelet adverse en éventail (partagé 3D ↔ overlay HUD). */
export function cupAngle(index: number, total: number): number {
  return Math.PI * 1.15 + (index * Math.PI) / Math.max(total - 1, 1);
}

/** Position écran horizontale approximative (0..1) d'un gobelet — caméra fixe. */
export function cupScreenX(index: number, total: number): number {
  return 0.5 + Math.cos(cupAngle(index, total)) * CUP_DIST * 0.21;
}

// Gobelet d'un adversaire + sa pile de dés (compte) ou ses dés révélés (god).
function OpponentCup({ index, total, count, isTurn, godDice }: {
  index: number; total: number; count: number; isTurn: boolean; godDice?: DieValue[];
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
        <mesh castShadow>
          <cylinderGeometry args={[0.3, 0.38, 0.6, 12]} />
          <meshStandardMaterial color={isTurn ? '#e8b74a' : '#a86f3d'} flatShading />
        </mesh>
      </group>
      {/* En god mode : les vraies faces sont révélées devant le gobelet */}
      {godDice?.map((d, i) => (
        <mesh key={i} position={[-0.5 + i * 0.22, 0.12, 0.35]}>
          <boxGeometry args={[0.17, 0.17, 0.17]} />
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

export function TableScene({ players, diceCounts, mySeat, godDice, turnSeat }: SceneProps) {
  const opponents = players.filter((p) => p.seat !== mySeat && p.seat < 100);
  return (
    <Canvas
      style={styles.canvas}
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 4.6, 7.2], fov: 58, near: 0.1, far: 60 }}
      onCreated={({ camera }) => camera.lookAt(0, -0.5, 0)}
    >
      <color attach="background" args={['#1a1410']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 6, 4]} intensity={1.4} castShadow />
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
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
