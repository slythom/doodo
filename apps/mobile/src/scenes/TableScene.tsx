import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import type { Group, Mesh } from 'three';

const SEATS = 6;
const TABLE_RADIUS = 2.6;

function Die({ position }: { position: [number, number, number] }) {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.4;
    }
  });
  return (
    <mesh ref={ref} position={position} castShadow>
      <boxGeometry args={[0.16, 0.16, 0.16]} />
      <meshStandardMaterial color="#f5f0e6" flatShading />
    </mesh>
  );
}

function Cup({ angle }: { angle: number }) {
  const r = TABLE_RADIUS - 0.7;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  return (
    <group position={[x, 0.28, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.22, 0.28, 0.45, 12]} />
        <meshStandardMaterial color="#8a5a2b" flatShading />
      </mesh>
    </group>
  );
}

function Table() {
  return (
    <group>
      {/* plateau */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.1, 24]} />
        <meshStandardMaterial color="#3d6b4f" flatShading />
      </mesh>
      {/* pied */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.18, 0.3, 1.1, 10]} />
        <meshStandardMaterial color="#5a3a20" flatShading />
      </mesh>
      {/* sol */}
      <mesh position={[0, -1.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#241a12" />
      </mesh>
    </group>
  );
}

function Scene() {
  const diceRef = useRef<Group>(null);
  const dice: [number, number, number][] = [
    [-0.5, 0.1, 1.4],
    [-0.15, 0.1, 1.5],
    [0.2, 0.1, 1.42],
    [0.55, 0.1, 1.48],
    [0.9, 0.1, 1.4],
  ];
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow />
      <Table />
      {Array.from({ length: SEATS - 1 }, (_, i) => (
        <Cup key={i} angle={Math.PI * 1.15 + (i * Math.PI) / (SEATS - 1)} />
      ))}
      <group ref={diceRef}>
        {dice.map((p, i) => (
          <Die key={i} position={p} />
        ))}
      </group>
    </>
  );
}

export function TableScene() {
  return (
    <Canvas
      style={styles.canvas}
      shadows
      camera={{
        position: [0, 2.1, 4.2],
        fov: 55,
        near: 0.1,
        far: 60,
      }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0, 0);
      }}
    >
      <color attach="background" args={['#1a1410']} />
      <Scene />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
