import '@/polyfills';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, useGLTF } from '@react-three/drei';
import { Asset } from 'expo-asset';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { AnimationAction, AnimationClip, AnimationMixer, BackSide, BufferAttribute,
  BufferGeometry, Color, LoopOnce, ShaderMaterial, Vector2, Vector3 } from 'three';
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
/** Rayon des avatars (derrière leur gobelet). */
const AVATAR_DIST = CUP_DIST + 0.72;

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
      if ((o as { isMesh?: boolean }).isMesh) o.castShadow = true;
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
  const x = Math.cos(angle) * AVATAR_DIST;
  const z = Math.sin(angle) * AVATAR_DIST;
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

/** Angle du i-ème gobelet adverse en éventail (partagé 3D ↔ overlay HUD).
 *  Symétrique autour du fond (270°, face caméra) — demi-ouverture bornée
 *  pour que les avatars des extrémités restent dans le champ portrait. */
export function cupAngle(index: number, total: number): number {
  if (total <= 1) return Math.PI * 1.5;
  const half = Math.min(1.2, (total - 1) * 0.45);
  const step = (half * 2) / (total - 1);
  return Math.PI * 1.5 + (index - (total - 1) / 2) * step;
}

/** Position écran horizontale approximative (0..1) d'un avatar — caméra fixe. */
export function cupScreenX(index: number, total: number): number {
  return 0.5 + Math.cos(cupAngle(index, total)) * AVATAR_DIST * 0.15;
}

/** Position écran verticale (0..1) : au-dessus de la tête de l'avatar —
 *  plus il est loin (z<0), plus il monte à l'écran. */
export function cupScreenY(index: number, total: number): number {
  const z = Math.sin(cupAngle(index, total)) * AVATAR_DIST;
  return 0.40 + z * 0.045;
}

const CUP_COLORS = ['#a86f3d', '#8a5a2b', '#9c6b4a', '#7a4f2e', '#b07840', '#6e4a30'];
const CUP_RIM = '#3d2415';    // bourrelet cuir foncé
const CUP_STITCH = '#d9b06c'; // surpiqûre claire

// Silhouette du gobelet (rayon, hauteur) — bas évasé, corps resserré,
// sommet légèrement bombé. Tournée autour de Y par latheGeometry.
const CUP_PROFILE = [
  new Vector2(0.42, 0.00),
  new Vector2(0.41, 0.05),
  new Vector2(0.34, 0.40),
  new Vector2(0.30, 0.56),
  new Vector2(0.20, 0.60),
  new Vector2(0.10, 0.62),
  new Vector2(0.00, 0.62),
];

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
    if (!cup.current) return;
    cup.current.position.y = isTurn
      ? 0.02 + Math.sin(s.clock.elapsedTime * 4) * 0.03
      : 0.02;
  });
  return (
    <group position={[x, 0, z]}>
      <group ref={cup} position={[0, 0.02, 0]}>
        {/* Corps du gobelet */}
        <mesh castShadow onClick={onTap} onPointerDown={onTap}>
          <latheGeometry args={[CUP_PROFILE, 32]} />
          <meshStandardMaterial
            color={isTurn ? '#e8b74a' : CUP_COLORS[seat % CUP_COLORS.length]}
            roughness={0.6} envMapIntensity={0.7} />
        </mesh>
        {/* Bourrelet au bas */}
        <mesh position={[0, 0.035, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[0.405, 0.045, 10, 24]} />
          <meshStandardMaterial color={isTurn ? '#b8862e' : CUP_RIM} roughness={0.7} />
        </mesh>
        {/* Surpiqûre */}
        <mesh position={[0, 0.33, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.353, 0.012, 6, 24]} />
          <meshStandardMaterial color={CUP_STITCH} roughness={0.8} />
        </mesh>
        {/* Médaillon au sommet */}
        <mesh position={[0, 0.615, 0]}>
          <cylinderGeometry args={[0.09, 0.11, 0.02, 16]} />
          <meshStandardMaterial color={isTurn ? '#b8862e' : CUP_RIM} roughness={0.7} />
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
        <coneGeometry args={[0.7, 0.5, 16, 1, true]} />
        <meshStandardMaterial color="#c8955c" side={2} roughness={0.5} metalness={0.3} />
      </mesh>
      <pointLight position={[0, -0.15, 0]} intensity={16} distance={9} color="#ffc98a" decay={2}
        castShadow shadow-mapSize={[512, 512]} shadow-bias={-0.002} />
    </group>
  );
}

// Tomate lancée : arc parabolique vers le gobelet de la cible, puis "splat".
function Tomato({ targetIndex, targetTotal, done }: { targetIndex: number; targetTotal: number; done: () => void }) {
  const g = useRef<Group>(null);
  const t = useRef(0);
  const splat = useRef(false);
  const angle = cupAngle(targetIndex, targetTotal);
  const tx = Math.cos(angle) * AVATAR_DIST;
  const tz = Math.sin(angle) * AVATAR_DIST;
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
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshStandardMaterial color="#c2352a" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <coneGeometry args={[0.07, 0.1, 8]} />
        <meshStandardMaterial color="#3d6b4f" roughness={0.8} />
      </mesh>
    </group>
  );
}

function Table() {
  return (
    <group>
      {/* Plateau feutre */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.1, 48]} />
        <meshStandardMaterial color="#2e5d43" roughness={0.95} envMapIntensity={0.15} />
      </mesh>
      {/* Chant bois sous le plateau */}
      <mesh position={[0, -0.07, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS + 0.06, TABLE_RADIUS + 0.04, 0.09, 48]} />
        <meshStandardMaterial color="#4a2e18" roughness={0.55} envMapIntensity={0.4} />
      </mesh>
      {/* Pied */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.18, 0.34, 1.1, 16]} />
        <meshStandardMaterial color="#4a2e18" roughness={0.6} />
      </mesh>
      <mesh position={[0, -1.13, 0]}>
        <cylinderGeometry args={[0.7, 0.8, 0.06, 20]} />
        <meshStandardMaterial color="#3a2415" roughness={0.6} />
      </mesh>
      <mesh position={[0, -1.15, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#1d130b" roughness={1} />
      </mesh>
    </group>
  );
}

// Voûte céleste dégradée — chaud à l'horizon, presque noir au zénith.
// ShaderMaterial : dégradé par pixel (les vertex colors bandaient) et
// pas de DOM canvas en React Native.
function SkyDome() {
  const mat = useMemo(() => new ShaderMaterial({
    uniforms: {
      cHorizon: { value: new Color('#3a2412') },
      cLow: { value: new Color('#171008') },
      cZenith: { value: new Color('#050302') },
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv;
      uniform vec3 cHorizon, cLow, cZenith;
      void main() {
        float y = vUv.y;
        vec3 c = mix(cLow, cHorizon, smoothstep(0.38, 0.55, y));
        c = mix(c, cZenith, smoothstep(0.58, 0.92, y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: BackSide,
    depthWrite: false,
  }), []);
  return (
    <mesh scale={45} material={mat}>
      <sphereGeometry args={[1, 48, 32]} />
    </mesh>
  );
}

// Champ d'étoiles maison — <Stars> de drei envoie un booléen dans un
// uniform float (crash expo-gl). Points fixes, sans uniform custom.
function StarField({ count = 1200, radius = 44 }: { count?: number; radius?: number }) {
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const v = new Vector3();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      v.setFromSphericalCoords(
        radius + Math.random() * 8,
        Math.acos(1 - 2 * Math.random()),
        Math.random() * Math.PI * 2);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.08 + Math.random() * 0.04, 0.3, 0.45 + Math.random() * 0.45);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    return g;
  }, [count, radius]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={1.8} sizeAttenuation={false} vertexColors
        transparent opacity={0.9} depthWrite={false} fog={false} />
    </points>
  );
}

export function TableScene({ players, diceCounts, mySeat, godDice, turnSeat, thrown, onThrow }: SceneProps) {
  const [tomatoDone, setTomatoDone] = useState(0);
  const opponents = players.filter((p) => p.seat !== mySeat && p.seat < 100);
  return (
    <Canvas
      style={styles.canvas}
      shadows="soft"
      dpr={[1, 2]}
      gl={{ toneMappingExposure: 1.15 }}
      camera={{ position: [0, 6.0, 9.8], fov: 62, near: 0.1, far: 60 }}
      onCreated={({ camera }) => camera.lookAt(0, -0.5, 0)}
    >
      <color attach="background" args={['#171008']} />
      <fog attach="fog" args={['#171008', 10.5, 21.5]} />
      <SkyDome />
      <StarField />
      {/* Env map procédurale (Lightformer, pas d'asset) → reflets cuir/bois */}
      <Environment resolution={128}>
        <Lightformer intensity={4} color="#ffd9a0" position={[0, 5, 1]}
          scale={[6, 6, 1]} rotation={[-Math.PI / 2, 0, 0]} />
        <Lightformer intensity={1.2} color="#3a4a70" position={[0, 3, -9]}
          scale={[14, 4, 1]} />
        <Lightformer intensity={0.8} color="#7a4a28" position={[-8, 2, 2]}
          scale={[4, 6, 1]} rotation={[0, Math.PI / 2, 0]} />
      </Environment>
      <ambientLight intensity={0.25} />
      {/* Key light chaude */}
      <directionalLight position={[4, 7, 3]} intensity={1.8} color="#ffe3b8" castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4} shadow-camera-right={4}
        shadow-camera-top={4} shadow-camera-bottom={-4}
        shadow-camera-near={1} shadow-camera-far={20}
        shadow-bias={-0.0004} />
      {/* Rim light froide dans le dos des joueurs */}
      <directionalLight position={[-3, 4, -6]} intensity={0.7} color="#8aa0d8" />
      <directionalLight position={[0, 3, 8]} intensity={0.35} /> {/* fill frontal */}
      <hemisphereLight args={['#f5e6c8', '#241a12', 0.3]} />
      <Suspension />
      <Table />
      {/* Ombres de contact pour ancrer gobelets/avatars sur le feutre */}
      <ContactShadows position={[0, 0.005, 0]} scale={7} far={1.2}
        blur={2.2} opacity={0.55} resolution={256} />
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
