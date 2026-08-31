import React, { useMemo, useRef, useState, useEffect, useCallback, memo } from 'react';
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html, Float } from '@react-three/drei';
import * as THREE from 'three';
import { Order } from '../types';
import { resolveLocation } from '../utils/geoUtils';
import {
    defaultWallpaperAccentPalette,
    deriveWallpaperAccentPalette,
    sampleWallpaperAverageColor,
    type WallpaperAccentPalette,
} from '../utils/wallpaperAccent';
import {
    GLOBE_AUTO_ROTATE_SPEED,
    GLOBE_GLOBAL_GEO,
    GLOBE_INTERACTION_RESUME_DELAY_MS,
    GLOBE_INTRO_GEO,
    GLOBE_MAX_ORBIT_DISTANCE,
    GLOBE_RADIUS,
} from './globeMotion';

/** Device-aware preset: keeps the same art direction, reduces mesh / fill-rate / CPU on tablets. */
export type GlobeQualityTier = 'high' | 'medium' | 'low';

export type GlobeQualityMode = GlobeQualityTier | 'auto';

export function resolveGlobeQuality(mode: GlobeQualityMode = 'auto'): GlobeQualityTier {
    if (mode !== 'auto') return mode;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'high';
    const nav = navigator as Navigator & { deviceMemory?: number };
    const mem = nav.deviceMemory;
    const cores = navigator.hardwareConcurrency ?? 8;
    try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low';
    } catch { /* ignore */ }
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const shortSide = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768);
    const tabletLike = coarse && shortSide >= 600;

    if (mem != null && mem <= 4) return 'low';
    if (tabletLike && mem != null && mem <= 8) return 'medium';
    if (tabletLike || (mem != null && mem <= 6)) return 'medium';
    if (cores <= 4) return 'medium';
    return 'high';
}

const TIER_PRESETS: Record<GlobeQualityTier, {
    dpr: [number, number];
    sphereSegments: number;
    layoutIterations: number;
    floatEnabled: boolean;
    floatSpeed: number;
    antialias: boolean;
    powerPreference: WebGLPowerPreference;
    /** Idle frame rate cap. User pointer/wheel events (handled by OrbitControls)
     * still call `invalidate()` directly, so dragging keeps a full 60Hz feel —
     * this only throttles the autoRotate / Float idle animation. */
    idleFps: number;
}> = {
    high: {
        // Capped at 1.75 instead of 2 — on retina/4K, 2x DPR means ~4x the
        // fragment-shader work, and the visible difference at 1.75 is
        // imperceptible. Saves ~23% fillrate.
        dpr: [1, 1.75],
        sphereSegments: 64,
        layoutIterations: 48,
        floatEnabled: true,
        floatSpeed: 0.2,
        antialias: true,
        powerPreference: 'high-performance',
        idleFps: 60
    },
    medium: {
        // 1.5 → 1.25 buys ~31% fillrate back on iPads (the worst-affected
        // class). Atmosphere + landmass + border shaders are all full-screen
        // overdraw, so this is the single biggest knob for tablets.
        dpr: [1, 1.25],
        sphereSegments: 48,
        layoutIterations: 30,
        floatEnabled: true,
        floatSpeed: 0.12,
        antialias: true,
        powerPreference: 'default',
        idleFps: 45
    },
    low: {
        dpr: [1, 1],
        sphereSegments: 40,
        layoutIterations: 18,
        floatEnabled: false,
        floatSpeed: 0,
        antialias: false,
        powerPreference: 'low-power',
        idleFps: 30
    }
};

function useDocumentVisible(): boolean {
    const [visible, setVisible] = useState(() =>
        typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
    );
    useEffect(() => {
        const onVis = () => setVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, []);
    return visible;
}

// Natural Earth 1:50m country polygons — fluid coastlines + realistic island
// chains, ~3 MB. Served from /public so the first-paint of country borders
// doesn't depend on raw.githubusercontent.com (frequently blocked / very slow
// in CJK regions, used to cause 5-30s of "no borders" on cold load).
// BASE_URL prefix lets this resolve under both the dev server (`/...`) and
// the Electron file:// protocol (`./...` relative to the loaded index.html).
const COUNTRY_GEOJSON_URL = `${import.meta.env.BASE_URL}ne_50m_admin_0_countries.geojson`;

let _countryGeoPromise: Promise<{ features: Array<{ geometry?: { type: string; coordinates: unknown } }> }> | null = null;

function loadCountryGeoOnce(): Promise<{ features: Array<{ geometry?: { type: string; coordinates: unknown } }> }> {
    if (!_countryGeoPromise) {
        _countryGeoPromise = fetch(COUNTRY_GEOJSON_URL).then(r => r.json());
    }
    return _countryGeoPromise;
}

// --- Constants ---
const HQ_LAT = 31.8755;
const HQ_LON = 120.5532;

function useWallpaperGlobeEdgePalette(wallpaperUrl: string | undefined, isDarkMode: boolean): WallpaperAccentPalette {
    const classicPalette = useMemo(() => defaultWallpaperAccentPalette(isDarkMode), [isDarkMode]);
    const [palette, setPalette] = useState<WallpaperAccentPalette>(classicPalette);

    useEffect(() => {
        let cancelled = false;
        if (!wallpaperUrl) {
            setPalette(classicPalette);
            return () => { cancelled = true; };
        }
        sampleWallpaperAverageColor(wallpaperUrl).then(sample => {
            if (cancelled) return;
            setPalette(sample ? deriveWallpaperAccentPalette(sample, isDarkMode) : classicPalette);
        });
        return () => { cancelled = true; };
    }, [classicPalette, isDarkMode, wallpaperUrl]);

    return palette;
}

const StatusColorMap: Record<string, string> = {
    /* 2026-09-01 雾蓝频道：与 MapLibreProductionGlobe 状态色对齐（旧彩虹色板退役） */
    'Alert': '#275768',
    'Pending': '#c6d9e2',
    'Production': '#275768',
    'Shipping': '#7fa3b3',
    'Delivered': '#2b4d60',
};

/** 订单状态中文标签（tooltip / 图例共用） */
const GLOBE_STATUS_LABEL_ZH: Record<string, string> = {
    'Alert': '告警',
    'Production': '生产中',
    'Shipping': '出运中',
    'Pending': '待处理',
    'Delivered': '已交付',
};

/** 图例/筛选 chip 展示顺序（五色全量，不再静默隐藏 Pending/Delivered） */
const GLOBE_STATUS_LEGEND_ORDER = ['Alert', 'Production', 'Shipping', 'Pending', 'Delivered'] as const;

// --- Helpers ---
const calcPosFromLatLonRad = (lat: number, lon: number, radius: number) => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));
    return new THREE.Vector3(x, y, z);
};

// PRE-CALCULATED POSITIONING FOR SEAMLESS FLOW
// Start: East China (Shanghai/Jiangsu), Medium Height (Dist 9) - Clear context of the region
const INTRO_START_POS = calcPosFromLatLonRad(GLOBE_INTRO_GEO.lat, GLOBE_INTRO_GEO.lon, GLOBE_INTRO_GEO.orbitDistance);
// End: Asia Strategic View (China Center), High Orbit (Dist 23) - Commanding global view, 地球更小
const GLOBAL_STRATEGIC_POS = calcPosFromLatLonRad(GLOBE_GLOBAL_GEO.lat, GLOBE_GLOBAL_GEO.lon, GLOBE_GLOBAL_GEO.orbitDistance);

// --- Layout Engine (Anti-Clutter) ---
// 订单定位真源：factoryLat/factoryLon（入库坐标）→ resolveLocation（真实地名表）；
// 均不命中时该订单不上图（假坐标兜底已退役，禁止把订单渲染到随机位置）。
function resolveOrderGeo(order: Order): { lat: number; lon: number } | null {
    if (order.factoryLat !== undefined && order.factoryLon !== undefined) {
        return { lat: order.factoryLat, lon: order.factoryLon };
    }
    return resolveLocation(order.millName || '');
}

function useSphericalLayout(orders: Order[], radius: number, iterations = 42) {
    return useMemo(() => {
        // 1. Initial Mapping（跳过无真实坐标的订单）
        const nodes = orders.flatMap(order => {
            const location = resolveOrderGeo(order);
            if (!location) return [];
            const { lat, lon } = location;

            const basePos = calcPosFromLatLonRad(lat, lon, radius);

            // Add tiny random jitter to break symmetry for identical stacks
            basePos.x += (Math.random() - 0.5) * 0.01;
            basePos.y += (Math.random() - 0.5) * 0.01;
            basePos.z += (Math.random() - 0.5) * 0.01;
            basePos.normalize().multiplyScalar(radius);

            return [{
                id: order.id,
                order,
                pos: basePos,
                velocity: new THREE.Vector3(0, 0, 0)
            }];
        });

        // 2. Physics Simulation (Repulsion)
        const REPULSION_RADIUS = 0.35; // Minimum distance between beams (tweak based on scale)
        const REPULSION_STRENGTH = 0.05;

        for (let i = 0; i < iterations; i++) {
            // Reset forces
            for (let n of nodes) n.velocity.set(0, 0, 0);

            // Calculate repulsion pairs
            for (let a = 0; a < nodes.length; a++) {
                for (let b = a + 1; b < nodes.length; b++) {
                    const nodeA = nodes[a];
                    const nodeB = nodes[b];

                    const diff = new THREE.Vector3().subVectors(nodeA.pos, nodeB.pos);
                    const dist = diff.length();

                    if (dist < REPULSION_RADIUS) {
                        // Force direction
                        const forceDir = diff.normalize();
                        if (dist < 0.001) forceDir.set(Math.random(), Math.random(), Math.random()).normalize(); // Safe random spread

                        const force = (REPULSION_RADIUS - dist) * REPULSION_STRENGTH;

                        nodeA.velocity.add(forceDir.multiplyScalar(force));
                        nodeB.velocity.sub(forceDir.multiplyScalar(force));
                    }
                }
            }

            // Apply velocity and re-project to sphere surface
            for (let n of nodes) {
                if (n.velocity.lengthSq() > 0) {
                    n.pos.add(n.velocity);
                    n.pos.normalize().multiplyScalar(radius);
                }
            }
        }

        // 3. Generate Final Transforms
        const layoutMap = new Map<string, { position: THREE.Vector3, quaternion: THREE.Quaternion }>();
        const up = new THREE.Vector3(0, 1, 0);

        nodes.forEach(n => {
            const finalPos = n.pos.clone();
            const norm = finalPos.clone().normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(up, norm);
            layoutMap.set(n.id, { position: finalPos, quaternion: q });
        });

        return layoutMap;
    }, [orders, radius, iterations]);
}

// 摄像机控制器组件 (统一物理引擎版)
function CameraController({ focusedOrder, layoutMap, isReady, registerZoom }: {
    focusedOrder: Order | null,
    layoutMap?: Map<string, { position: THREE.Vector3 }>,
    isReady: boolean,
    /** 暴露受控缩放通道给 DOM 缩放按钮（与滚轮缩放同语义：直接 dolly，标记交互时间） */
    registerZoom?: (fn: (dir: 1 | -1) => void) => void
}) {
    const { camera, gl } = useThree();
    const controlsRef = React.useRef<any>(null);
    const isInteracting = React.useRef(false);
    const lastInteractionTime = React.useRef(Date.now());
    const hasIntroFinished = React.useRef(false);
    const introDelayTimer = React.useRef<NodeJS.Timeout | null>(null);

    // 注册缩放通道：沿视线方向 dolly，距离夹在 OrbitControls 的 min/max 区间内
    useEffect(() => {
        if (!registerZoom) return;
        registerZoom((dir) => {
            const controls = controlsRef.current;
            if (!controls) return;
            const offset = camera.position.clone().sub(controls.target);
            const nextLen = THREE.MathUtils.clamp(
                offset.length() * (dir > 0 ? 1 / 1.35 : 1.35),
                GLOBE_RADIUS + 1,
                GLOBE_MAX_ORBIT_DISTANCE,
            );
            offset.setLength(nextLen);
            camera.position.copy(controls.target).add(offset);
            // 与手动交互同语义：暂停自动巡航的瞬间接管
            lastInteractionTime.current = Date.now();
            controls.update(0);
        });
    }, [registerZoom, camera]);

    // Initial positioning lock
    useEffect(() => {
        if (!isReady) {
            camera.position.copy(INTRO_START_POS);
            camera.lookAt(new THREE.Vector3(0, 0, 0));
        }
    }, [isReady, camera]);

    useFrame((state, delta) => {
        const controls = controlsRef.current;
        if (!controls) return;

        // If not ready, freeze camera at start pos
        if (!isReady) {
            camera.position.copy(INTRO_START_POS);
            camera.lookAt(new THREE.Vector3(0, 0, 0));
            controls.target.set(0, 0, 0);
            controls.update(delta); // Important to update even if frozen
            return;
        }

        const now = Date.now();
        const inactiveTime = now - lastInteractionTime.current;

        // 交互逻辑优先级最高
        if (isInteracting.current) {
            controls.autoRotate = false;
            lastInteractionTime.current = now;
            // 只要用户交互，立即标记 intro 完成
            if (!hasIntroFinished.current) hasIntroFinished.current = true;
            controls.update(delta);
            return;
        }

        // ============================================================
        // 核心物理引擎：聚焦 vs 全局回归
        // ============================================================

        let targetPosVec: THREE.Vector3;
        let targetLookAtVec: THREE.Vector3;
        let shouldAutoRotate = true;
        let lerpSpeed = 0.05; // 默认较快响应

        if (focusedOrder) {
            // [FOCUSED STATE]
            shouldAutoRotate = false;

            // 使用 Layout 后的视觉位置，确保直接看向排开后的光柱
            let targetCenter: THREE.Vector3;

            if (layoutMap && layoutMap.has(focusedOrder.id)) {
                targetCenter = layoutMap.get(focusedOrder.id)!.position.clone();
            } else {
                // Fallback (Should rarely happen if logic is synced)
                // 无真实坐标时聚焦回全局战略锚点（GLOBE_GLOBAL_GEO 为声明常量，非伪坐标）
                const geo = resolveOrderGeo(focusedOrder) ?? { lat: GLOBE_GLOBAL_GEO.lat, lon: GLOBE_GLOBAL_GEO.lon };
                targetCenter = calcPosFromLatLonRad(geo.lat, geo.lon, GLOBE_RADIUS);
            }

            // 目标：订单上方即视感 (Radius 5 + 4 = 9)
            targetLookAtVec = targetCenter.clone();
            targetPosVec = targetCenter.clone().normalize().multiplyScalar(GLOBE_RADIUS + 4);

        } else {
            // [GLOBAL STATE]
            shouldAutoRotate = true;
            targetPosVec = GLOBAL_STRATEGIC_POS;
            targetLookAtVec = new THREE.Vector3(0, 0, 0); // 原点
            lerpSpeed = 0.005; // 慢速电影感回归
        }

        // 回归/飞行逻辑
        const shouldApplyPhysics = focusedOrder ? true : (!hasIntroFinished.current || inactiveTime > GLOBE_INTERACTION_RESUME_DELAY_MS);

        if (shouldApplyPhysics) {
            // [LOGIC UPDATE] 
            // If we are in "Global Stable" mode (shouldAutoRotate=true AND introFinished),
            // we must NOT lerp the position to a fixed point, otherwise we fight the rotation.
            // We ONLY lerp position if:
            // 1. We are focusing on an order (locked view)
            // 2. We are in the Intro phase (flying to start)

            const isGlobalStable = !focusedOrder && hasIntroFinished.current;

            if (!isGlobalStable) {
                // A. Camera Position Lerp (Only when NOT rotating freely)
                camera.position.lerp(targetPosVec, lerpSpeed);
            } else {
                // Optional: In global stable mode, we might want to ensure we stay at the right 'height' (Radius),
                // but let Azimuth/Polar change. For now, simply releasing the lock allows AutoRotate to work.
                // If we want to return to "Asia View" after interaction, we can do a one-time lerp or check distance.

                // Let's implement a "Soft return to Radius" if user zoomed way out
                const currentDist = camera.position.length();
                const targetDist = GLOBAL_STRATEGIC_POS.length();
                if (Math.abs(currentDist - targetDist) > 1) {
                    // Gently pull back to orbit height if too far/close
                    const dir = camera.position.clone().normalize();
                    const targetHeightPos = dir.multiplyScalar(targetDist);
                    camera.position.lerp(targetHeightPos, 0.01);
                }
            }

            // B. Controls Target Lerp (LookAt) - We always want to look at center (0,0,0) or target
            controls.target.lerp(targetLookAtVec, lerpSpeed);
        }

        // ============================================================
        // 智能速度控制系统 (仅在 Global 模式下有效)
        // ============================================================
        if (shouldAutoRotate) {
            controls.autoRotate = true;
            const targetSpeed = GLOBE_AUTO_ROTATE_SPEED;

            if (!hasIntroFinished.current) {
                const currentRadius = camera.position.length();
                const targetRadius = GLOBAL_STRATEGIC_POS.length();
                const radiusDiff = Math.abs(currentRadius - targetRadius);

                if (radiusDiff < 0.5) {
                    if (!introDelayTimer.current) {
                        hasIntroFinished.current = true;
                    }
                }
                controls.autoRotateSpeed = targetSpeed;
            } else {
                controls.autoRotateSpeed = targetSpeed;
            }
        } else {
            controls.autoRotate = false;
        }

        controls.update(delta);
    });

    return (
        <OrbitControls
            ref={controlsRef}
            makeDefault
            enablePan={false}
            minDistance={GLOBE_RADIUS + 1} // 允许拉得更近
            maxDistance={GLOBE_MAX_ORBIT_DISTANCE}
            dampingFactor={0.06}
            enableDamping
            autoRotate={true}
            autoRotateSpeed={0}
            onStart={() => {
                isInteracting.current = true;
                if (introDelayTimer.current) {
                    clearTimeout(introDelayTimer.current);
                    introDelayTimer.current = null;
                }
            }}
            onEnd={() => {
                isInteracting.current = false;
                lastInteractionTime.current = Date.now();
            }}
        />
    );
}

// 1. Atmosphere Glow.
// `segments` is intentionally hard-capped at 32 regardless of the caller's
// preset: this sphere only renders a soft fresnel halo (no texture, no
// detail features), so its silhouette smoothness is what matters — and 32
// segments is already past the point where the human eye can detect any
// polygonal jaggies on a backside fresnel. Going from the main globe's
// 64/48/40 to a flat 32 here cuts triangle count by 36-75% per tier, which
// directly drops vertex-shader cost on the atmosphere pass.
function Atmosphere({ radius, color, segments }: { radius: number; color: string; segments?: number }) {
    const atmoSegments = Math.min(32, segments ?? 32);
    return (
        <mesh scale={[1.3, 1.3, 1.3]}>
            <sphereGeometry args={[radius, atmoSegments, atmoSegments]} />
            <shaderMaterial
                transparent
                side={THREE.BackSide}
                blending={THREE.AdditiveBlending}
                uniforms={{ color: { value: new THREE.Color(color) } }}
                vertexShader={`
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
                fragmentShader={`
          uniform vec3 color;
          varying vec3 vNormal;
          void main() {
            float intensity = pow(max(0.54 - dot(vNormal, vec3(0, 0, 1.0)), 0.0), 3.4);
            gl_FragColor = vec4(color, intensity * 0.22);
          }
        `}
            />
        </mesh>
    );
}

// 3. Optimized Instanced Data Beams (Single Draw Call)
function DataBeamInstances({ orders, radius, onFocus, focusedId, onOpenOrder }: {
    orders: Order[],
    radius: number,
    onFocus: (o: Order) => void,
    focusedId: string | null,
    onOpenOrder?: (orderId: string) => void
}) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const [hoveredOrder, setHoveredOrder] = useState<Order | null>(null);
    // tooltip 悬停锁：光束 pointerout 后若指针进入 tooltip 卡片，保持悬停目标不消失，
    // 否则用户永远无法点到 tooltip 内的「查看订单」按钮。
    const [tooltipHover, setTooltipHover] = useState(false);
    const lastHoveredOrderRef = useRef<Order | null>(null);
    // Track the currently-hovered instanceId in a ref so we can short-circuit
    // duplicate pointer events without paying React reconciliation cost.
    // R3F dispatches onPointerOver per-instance during raycast; when the cursor
    // sweeps across many beams this would otherwise fire setState 60+ times/s
    // and — under frameloop='demand' (A2) — force-invalidate every frame,
    // negating the idle FPS throttle entirely.
    const hoveredIdRef = useRef<number | null>(null);

    // Optimized Geometry: Single Plane (sufficient for data beams at scale)
    // We lift the origin to y=0.5 so scaling via scale.y works from the bottom up
    const geometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(0.06, 1);
        geo.translate(0, 0.5, 0);
        return geo;
    }, []);

    // Optimized Shader Material
    const material = useMemo(() => new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
            uTime: { value: 0 }
        },
        vertexShader: `
            attribute float aHeight;
            attribute vec3 aColor;
            varying vec2 vUv;
            varying vec3 vColor;
            
            void main() {
                vUv = uv;
                vColor = aColor;
                
                // Scale height based on instance attribute
                vec3 transformed = position;
                transformed.y *= aHeight;
                
                // Standard instanced transforms
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            varying vec3 vColor;
            
            void main() {
                // Procedural beam gradient
                float alphaY = smoothstep(1.0, 0.0, vUv.y);
                float alphaX = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
                float core = smoothstep(0.05, 0.0, abs(vUv.x - 0.5));
                
                // Core is brighter (white mix), edges are colored
                vec3 finalColor = mix(vColor, vec3(1.0), core * 0.8);
                float alpha = alphaY * (alphaX * 0.5 + core * 0.8);
                
                gl_FragColor = vec4(finalColor, alpha);
            }
        `
    }), []);

    // Update Instances
    useEffect(() => {
        if (!meshRef.current) return;

        const mesh = meshRef.current;
        const tempObj = new THREE.Object3D();
        const colors = new Float32Array(orders.length * 3);
        const heights = new Float32Array(orders.length);

        orders.forEach((order, i) => {
            const location = resolveOrderGeo(order);
            // 上游 activeOrders 已过滤无坐标订单；防御性跳过，避免把实例矩阵留在原点
            if (!location) return;
            const { lat, lon } = location;

            // Calculate Position on Sphere
            const pos = calcPosFromLatLonRad(lat, lon, radius);
            const norm = pos.clone().normalize();

            // Calculate Rotation (Point outwards)
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm);

            // Set Transform
            tempObj.position.copy(pos);
            tempObj.quaternion.copy(q);
            tempObj.updateMatrix();
            mesh.setMatrixAt(i, tempObj.matrix);

            // Set Color Instance Attribute
            const c = new THREE.Color(StatusColorMap[order.status] || '#cbd5e1');
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;

            // Set Height Instance Attribute
            // Scale data quantity to visual height (1.5 to 5.0 units)
            heights[i] = Math.min(Math.max(order.quantity / 800, 1.5), 5.0);
        });

        // Update Geometry Attributes
        mesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
        mesh.geometry.setAttribute('aHeight', new THREE.InstancedBufferAttribute(heights, 1));
        mesh.instanceMatrix.needsUpdate = true;

    }, [orders, radius]);

    // Cursor is now driven by hover state, not by raw pointer events. This
    // collapses N writes/sec into at most 1 per actual hover transition.
    useEffect(() => {
        document.body.style.cursor = hoveredOrder ? 'pointer' : 'auto';
        return () => { document.body.style.cursor = 'auto'; };
    }, [hoveredOrder]);

    const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
        const id = e.instanceId;
        if (id !== undefined && orders[id]) {
            e.stopPropagation();
            onFocus(orders[id]);
        }
    }, [orders, onFocus]);

    const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        const id = e.instanceId;
        if (id === undefined || !orders[id]) return;
        // Same instance as before — short-circuit before touching React state.
        if (hoveredIdRef.current === id) return;
        hoveredIdRef.current = id;
        lastHoveredOrderRef.current = orders[id];
        setHoveredOrder(orders[id]);
    }, [orders]);

    const handlePointerOut = useCallback(() => {
        if (hoveredIdRef.current === null) return;
        hoveredIdRef.current = null;
        setHoveredOrder(null);
    }, []);

    // 指针移出光束但进入 tooltip 卡片时，tooltip 保持显示（悬停锁）
    const effectiveHoveredOrder = hoveredOrder ?? (tooltipHover ? lastHoveredOrderRef.current : null);
    const tooltipHoverProps = {
        onPointerEnter: () => setTooltipHover(true),
        onPointerLeave: () => setTooltipHover(false),
    };

    return (
        <>
            <instancedMesh
                ref={meshRef}
                args={[geometry, material, orders.length]}
                onClick={handleClick}
                onPointerOver={handlePointerOver}
                onPointerOut={handlePointerOut}
            />

            {/* Tooltip Overlay */}
            {effectiveHoveredOrder && (
                <BeamTooltip order={effectiveHoveredOrder} isFocused={focusedId === effectiveHoveredOrder.id} radius={radius} onOpenOrder={onOpenOrder} hoverProps={tooltipHoverProps} />
            )}
            {focusedId && orders.find(o => o.id === focusedId) && !effectiveHoveredOrder && (
                <BeamTooltip order={orders.find(o => o.id === focusedId)!} isFocused={true} radius={radius} onOpenOrder={onOpenOrder} hoverProps={tooltipHoverProps} />
            )}
        </>
    );
}

// Positioning Helper for Tooltip
function BeamTooltip({ order, isFocused, radius, onOpenOrder, hoverProps }: {
    order: Order,
    isFocused: boolean,
    radius: number,
    onOpenOrder?: (orderId: string) => void,
    hoverProps?: { onPointerEnter: () => void; onPointerLeave: () => void }
}) {
    const location = resolveOrderGeo(order);
    // 无真实坐标的订单本不上图，tooltip 亦不渲染
    if (!location) return null;
    const { lat, lon } = location;

    // Calculate top of the beam position
    const height = Math.min(Math.max(order.quantity / 800, 1.5), 5.0);
    const pos = calcPosFromLatLonRad(lat, lon, radius);
    const tipPos = pos.clone().normalize().multiplyScalar(radius + height);

    const color = StatusColorMap[order.status] || '#cbd5e1';

    return (
        <Html position={tipPos} center zIndexRange={[100, 0]}>
            <div
                {...hoverProps}
                className={`
 border p-4 rounded-inset text-white min-w-[220px] transition-colors duration-300 pointer-events-auto select-none
                ${isFocused
                    ? 'bg-deep/90 border-[var(--text-on-dark-2)] scale-110'
                    : 'bg-deep/90 border-[var(--text-on-dark-4)] scale-100'}
            `} style={{ boxShadow: 'var(--shadow-dropdown)' }}>
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-light tracking-[0.2em] text-[var(--text-on-dark-2)]">{GLOBE_STATUS_LABEL_ZH[order.status] || order.status}</div>
                    <div className={`w-2 h-2 rounded-full ${isFocused ? 'animate-pulse' : ''}`} style={{ backgroundColor: color }}></div>
                </div>
                <div className="text-sm font-light truncate mb-3">{order.millName}</div>
                <div className="grid grid-cols-2 gap-4 text-[10px] border-t border-white/10 pt-3">
                    <div><div className="text-[var(--text-on-dark-3)] mb-0.5">数量</div><div className="font-light">{order.quantity.toLocaleString()}</div></div>
                    <div className="text-right"><div className="text-[var(--text-on-dark-3)] mb-0.5">金额</div><div className="font-light text-[var(--os-vnext-brand-blue-soft)]">${(order.quoteAmount / 1000).toFixed(1)}k</div></div>
                </div>
                {onOpenOrder && (
                    <button
                        type="button"
                        className="mt-3 w-full rounded-control border border-white/20 px-3 py-1.5 text-xs font-light text-white transition-colors hover:bg-white/10"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenOrder(order.id);
                        }}
                    >
                        查看订单
                    </button>
                )}
            </div>
        </Html>
    );
}

function CountryBordersLines({ radius, color, onError }: { radius: number; color: string; onError?: () => void }) {
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

    useEffect(() => {
        let cancelled = false;
        let built: THREE.BufferGeometry | null = null;
        const ac = new AbortController();

        loadCountryGeoOnce()
            .then(data => {
                if (cancelled) return;

                const positions: number[] = [];

                const processRing = (ring: number[][]) => {
                    if (!ring || ring.length < 2) return;
                    for (let i = 0; i < ring.length - 1; i++) {
                        const p1 = ring[i];
                        const p2 = ring[i + 1];
                        const v1 = calcPosFromLatLonRad(p1[1], p1[0], radius);
                        const v2 = calcPosFromLatLonRad(p2[1], p2[0], radius);
                        positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
                    }
                };

                data.features.forEach(feature => {
                    const g = feature.geometry;
                    if (!g) return;
                    if (g.type === 'Polygon') {
                        (g.coordinates as number[][][]).forEach(processRing);
                    } else if (g.type === 'MultiPolygon') {
                        (g.coordinates as number[][][][]).forEach(poly => poly.forEach(processRing));
                    }
                });

                if (cancelled) return;
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                built = geo;
                setGeometry(geo);
            })
            .catch(err => {
                if ((err as Error).name === 'AbortError') return;
                console.error('[ProductionGlobe] country borders (lines)', err);
                // 国界叠加层失败上抛：由外层渲染用户可见降级提示（原仅 console，国界静默消失）
                onError?.();
            });

        return () => {
            cancelled = true;
            ac.abort();
            if (built) {
                built.dispose();
                built = null;
            }
        };
    }, [radius]);

    const borderMaterial = useMemo(() => new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(color) } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vNormal = normalize(normalMatrix * position);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vec3 viewDir = normalize(vViewPosition);
                float dotProduct = dot(vNormal, viewDir);
                if (dotProduct < 0.0) discard;
                float t = smoothstep(0.0, 0.5, dotProduct);
                vec3 finalColor = mix(color * 0.3, color + vec3(0.4), t);
                float opacity = mix(0.1, 0.9, t);
                gl_FragColor = vec4(finalColor, opacity);
            }
        `
    }), [color]);

    useEffect(() => () => borderMaterial.dispose(), [borderMaterial]);

    if (!geometry) return null;
    return <lineSegments geometry={geometry} material={borderMaterial} />;
}

// =====================================================================
// Earliest-version landmass — kept for `baked` mode where the user
// explicitly asked for the original "light, transparent, soft-halo" feel.
//
// Differences vs the current `LandmassPlain` (used by `lines` mode):
//   - Source mask: JPG specular map (NOT the vector polygon mask). Its
//     anti-aliased coastline produces a halo of partially-transparent
//     "edge land" that visually reads as a soft glow around continents.
//   - discard threshold:  isLand < 0.05  (vs 0.02 + fwidth in new version),
//     so the halo pixels keep rendering at very low alpha → "transparent
//     glow" look the user remembered.
//   - baseOpacity: 0.3 (vs 0.4 in new version) → lighter body.
//   - No coast halo / fwidth / vector AA.
// =====================================================================
// Local 2048x1024 specular mask — was previously fetched from
// raw.githubusercontent.com (the three.js examples mirror), which is
// frequently blocked or extremely slow in CJK regions and contributed
// 5–30s of "blank globe" on first load. The local copy is served by Vite
// from /public, so it's bundled, hits the disk cache aggressively, and
// removes the network round-trip from first paint entirely.
// Use BASE_URL so this resolves correctly under both the web dev server
// (`/earth_specular_2048.jpg`) and the Electron file:// protocol
// (`./earth_specular_2048.jpg` — relative to the loaded index.html).
const ORIGINAL_LAND_MASK_URL = `${import.meta.env.BASE_URL}earth_specular_2048.jpg`;

export function preloadProductionGlobeAssets(): void {
    if (typeof window === 'undefined') return;
    loadCountryGeoOnce().catch(() => {});
    useLoader.preload(THREE.ImageBitmapLoader, ORIGINAL_LAND_MASK_URL, (loader) => {
        (loader as THREE.ImageBitmapLoader).setOptions({ imageOrientation: 'flipY' });
    });
}

function LandmassClassic({
    radius,
    segments = 64,
    color,
    rimColor,
}: {
    radius: number;
    segments?: number;
    color: string;
    rimColor: string;
}) {
    // Use ImageBitmapLoader instead of TextureLoader so JPG decode runs
    // off the main thread via createImageBitmap(). On iPad Safari this
    // saves ~50–100ms of first-paint blocking time. Visual output is
    // identical: imageOrientation:'flipY' bakes the Y-flip into the
    // bitmap and we set texture.flipY=false to avoid GL re-flipping on
    // upload — net result matches the original TextureLoader path.
    const bitmap = useLoader(THREE.ImageBitmapLoader, ORIGINAL_LAND_MASK_URL, (loader) => {
        (loader as THREE.ImageBitmapLoader).setOptions({ imageOrientation: 'flipY' });
    }) as unknown as ImageBitmap;
    const { gl } = useThree();

    const mask = useMemo(() => {
        const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
        tex.flipY = false;
        tex.needsUpdate = true;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy?.() ?? 4);
        return tex;
    }, [bitmap, gl]);

    useEffect(() => () => { mask.dispose(); }, [mask]);

    return (
        <mesh>
            <sphereGeometry args={[radius, segments, segments]} />
            <shaderMaterial
                transparent
                side={THREE.DoubleSide}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                uniforms={{
                    map: { value: mask },
                    uColor: { value: new THREE.Color(color) },
                    uRimColor: { value: new THREE.Color(rimColor) }
                }}
                vertexShader={`
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;
                    void main() {
                        vUv = uv;
                        vNormal = normalize(normalMatrix * normal);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        vViewPosition = -mvPosition.xyz;
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `}
                fragmentShader={`
                    uniform sampler2D map;
                    uniform vec3 uColor;
                    uniform vec3 uRimColor;
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vViewPosition;

                    void main() {
                        // Original JPG specular mask — its AA coastline
                        // produces partially-transparent "edge land" pixels
                        // that the soft discard (<0.05) lets through, giving
                        // the continents the original soft transparent glow.
                        float maskValue = texture2D(map, vUv).r;
                        float isLand = 1.0 - smoothstep(0.1, 0.2, maskValue);
                        if (isLand < 0.05) discard;

                        vec3 viewDir = normalize(vViewPosition);
                        float facing = dot(vNormal, viewDir);
                        float fresnel = pow(1.0 - abs(facing), 2.5);

                        vec3 finalColor = mix(uColor * 0.25, uRimColor, fresnel);
                        float baseOpacity = 0.3;
                        if (facing < 0.0) baseOpacity *= 0.2;

                        float alpha = isLand * (baseOpacity + fresnel * 0.6);
                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `}
            />
        </mesh>
    );
}

// --- Idle frame-rate throttle ---------------------------------------------
// In `frameloop="demand"` mode the canvas only renders when something calls
// `invalidate()`. OrbitControls invalidates on pointer / wheel events, so
// dragging stays a buttery 60Hz regardless of the cap. The throttle below
// only governs the IDLE animation (autoRotate spin + Float bob).
//
// IMPORTANT: we use `requestAnimationFrame` (NOT `setInterval`) because RAF
// is hard-locked to the display's vsync, while setInterval has its own
// independent clock that drifts relative to vsync — producing "一抽一抽"
// (irregular jank) at any rate other than the display refresh rate.
//
// Algorithm: count RAF ticks, only invalidate every ⌊refresh/targetFps⌋
// ticks. On a 60Hz display: targetFps=60 → every tick (60Hz, smooth);
// targetFps=30 → every 2nd tick (30Hz, still vsync-aligned, no jank);
// targetFps=45 → every 1.33 ticks (rounded to 1, effectively 60Hz).
//
// Tab hidden → enabled=false → no RAF loop → zero render cost.
const FrameThrottle: React.FC<{ targetFps: number; enabled: boolean }> = ({ targetFps, enabled }) => {
    const invalidate = useThree(s => s.invalidate);
    useEffect(() => {
        if (!enabled) return;
        let rafId = 0;
        let counter = 0;
        // We don't know the display refresh rate, but for the common 60Hz/120Hz
        // case targetFps≤60 maps cleanly: 60→1, 30→2, 20→3, 15→4. For 45Hz
        // (medium tier) on 60Hz display we'd want 1.33 ticks → just use 1
        // (60Hz) which is faster than asked and still vsync-locked.
        const skipFrames = Math.max(1, Math.floor(60 / targetFps));
        const tick = () => {
            counter++;
            if (counter >= skipFrames) {
                counter = 0;
                invalidate();
            }
            rafId = window.requestAnimationFrame(tick);
        };
        rafId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(rafId);
    }, [targetFps, enabled, invalidate]);
    return null;
};

// --- Helper component to handle view offset without shifting rotation axis ---
export interface GlobeViewportCenter {
    x: number;
    y: number;
    width?: number;
    height?: number;
}

const ViewOffsetManager: React.FC<{ sidebarOffset: number; viewportCenter?: GlobeViewportCenter | null }> = ({ sidebarOffset, viewportCenter }) => {
    const { camera, gl, size } = useThree();

    useEffect(() => {
        if (camera instanceof THREE.PerspectiveCamera) {
            let offsetX = -sidebarOffset / 2;
            let offsetY = 0;
            if (viewportCenter) {
                const canvasRect = gl.domElement.getBoundingClientRect();
                const targetX = canvasRect.width > 0
                    ? ((viewportCenter.x - canvasRect.left) / canvasRect.width) * size.width
                    : size.width / 2;
                const targetY = canvasRect.height > 0
                    ? ((viewportCenter.y - canvasRect.top) / canvasRect.height) * size.height
                    : size.height / 2;
                offsetX = size.width / 2 - targetX;
                offsetY = size.height / 2 - targetY;
            }
            camera.setViewOffset(size.width, size.height, offsetX, offsetY, size.width, size.height);
            camera.updateProjectionMatrix();
        }
        return () => {
            if (camera instanceof THREE.PerspectiveCamera) {
                camera.clearViewOffset();
            }
        };
    }, [camera, gl, sidebarOffset, size, viewportCenter]);

    return null;
};

// --- Main Scene ---
export interface ProductionGlobeProps {
    orders: Order[];
    sidebarOffset?: number;
    isDarkMode?: boolean;
    wallpaperUrl?: string;
    initialDelay?: number;
    /** default `auto`: lowers mesh & fill rate on tablets / low-memory devices */
    quality?: GlobeQualityMode;
    viewportCenter?: GlobeViewportCenter | null;
    /** tooltip「查看订单」直达（App 侧 handleOpenOrderById） */
    onOpenOrder?: (orderId: string) => void;
}

const ProductionGlobeImpl: React.FC<ProductionGlobeProps> = ({
    orders,
    sidebarOffset = 0,
    isDarkMode = false,
    wallpaperUrl = '',
    initialDelay = 0,
    quality = 'auto',
    viewportCenter = null,
    onOpenOrder
}) => {
    const [focusedOrder, setFocusedOrder] = useState<Order | null>(null);
    const [isReady, setIsReady] = useState(initialDelay === 0);
    // 图例即筛选：默认五状态全显（Pending/Delivered 不再静默缺席），点击 chip 切换显隐
    const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<string>>(new Set());
    // 国界叠加层加载失败的用户可见提示（可关闭）
    const [bordersDegraded, setBordersDegraded] = useState(false);
    const docVisible = useDocumentVisible();

    const tier = useMemo(() => resolveGlobeQuality(quality), [quality]);
    const preset = TIER_PRESETS[tier];
    const edgePalette = useWallpaperGlobeEdgePalette(wallpaperUrl, isDarkMode);

    // 缩放按钮通道：由 CameraController 注册实际 dolly 实现
    const zoomFnRef = useRef<(dir: 1 | -1) => void>(() => {});
    const registerZoom = useCallback((fn: (dir: 1 | -1) => void) => {
        zoomFnRef.current = fn;
    }, []);

    const toggleStatus = useCallback((status: string) => {
        setHiddenStatuses(prev => {
            const next = new Set(prev);
            if (next.has(status)) next.delete(status);
            else next.add(status);
            return next;
        });
    }, []);

    const handleBordersError = useCallback(() => setBordersDegraded(true), []);

    // Initial Delay Timer
    useEffect(() => {
        if (initialDelay > 0) {
            const timer = setTimeout(() => setIsReady(true), initialDelay);
            return () => clearTimeout(timer);
        }
    }, [initialDelay]);

    // 上图口径：全部真实可定位订单（入库坐标或地名表命中），按图例筛选显隐。
    // 历史白名单只显 Alert/Production/Shipping，导致 Pending/Delivered 订单静默消失。
    const activeOrders = useMemo(
        () => orders.filter(order => resolveOrderGeo(order) !== null && !hiddenStatuses.has(order.status)),
        [orders, hiddenStatuses]
    );

    // 各状态可定位订单计数（图例 chip 徽标）
    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const o of orders) {
            if (resolveOrderGeo(o) === null) continue;
            counts[o.status] = (counts[o.status] || 0) + 1;
        }
        return counts;
    }, [orders]);

    // 聚焦订单被图例隐藏时解除聚焦，避免相机锁定在已不可见的光束上
    useEffect(() => {
        if (focusedOrder && hiddenStatuses.has(focusedOrder.status)) setFocusedOrder(null);
    }, [focusedOrder, hiddenStatuses]);

    const layoutMap = useSphericalLayout(activeOrders, GLOBE_RADIUS, preset.layoutIterations);

    const sceneContent = (
        <group key={`${isDarkMode ? 'dark' : 'light'}:${edgePalette.globeAtmosphere}:${edgePalette.globeBorder}`}>
            <Atmosphere radius={GLOBE_RADIUS} color={edgePalette.globeAtmosphere} segments={preset.sphereSegments} />
            <React.Suspense fallback={null}>
                <LandmassClassic
                    radius={GLOBE_RADIUS}
                    segments={preset.sphereSegments}
                    color={edgePalette.globeLand}
                    rimColor={edgePalette.globeLandRim}
                />
                <CountryBordersLines radius={GLOBE_RADIUS * 1.0005} color={edgePalette.globeBorder} onError={handleBordersError} />
                <DataBeamInstances
                    orders={activeOrders}
                    radius={GLOBE_RADIUS}
                    onFocus={setFocusedOrder}
                    focusedId={focusedOrder?.id || null}
                    onOpenOrder={onOpenOrder}
                />
            </React.Suspense>
        </group>
    );

    return (
        <div className="w-full h-full relative overflow-hidden">
            <Canvas
                camera={{ position: INTRO_START_POS, fov: 32 }}
                // During intro/focus camera animation, clamp DPR to 1.0 — the
                // landmass+atmosphere+border shaders are full-screen overdraw,
                // so on Retina (DPR 2.0) the GPU was running ~4× the pixels of
                // a logical-pixel render and dropping to ~25fps mid-lerp. The
                // visual hit on a 0.005-lerp moving camera is invisible (motion
                // blur masks aliasing); once the camera settles we restore the
                // full preset.dpr ceiling for static crispness.
                dpr={preset.dpr}
                // Frameloop policy: original (pre-Electron-port) behaviour.
                //   • docVisible → 'demand': renders only on invalidate().
                //                            FrameThrottle below polls
                //                            invalidate at preset.idleFps
                //                            (60/45/30 by tier) for the
                //                            autoRotate/Float idle animation;
                //                            OrbitControls invalidates extra
                //                            on pointer/wheel events.
                //   • else       → 'never':  background tab, zero GPU cost.
                frameloop={docVisible ? 'demand' : 'never'}
                gl={{
                    antialias: preset.antialias,
                    alpha: true,
                    powerPreference: preset.powerPreference,
                    stencil: false,
                    depth: true
                }}
                onPointerMissed={() => setFocusedOrder(null)}
            >
                <ambientLight intensity={1.1} />
                <pointLight position={[10, 10, 10]} intensity={0.5} />
                <directionalLight position={[-5, 5, 5]} intensity={0.3} />

                <FrameThrottle targetFps={preset.idleFps} enabled={docVisible} />
                <ViewOffsetManager sidebarOffset={sidebarOffset} viewportCenter={viewportCenter} />
                <CameraController
                    focusedOrder={focusedOrder}
                    layoutMap={layoutMap}
                    isReady={isReady}
                    registerZoom={registerZoom}
                />

                {preset.floatEnabled ? (
                    <Float
                        speed={preset.floatSpeed}
                        rotationIntensity={0.05}
                        floatIntensity={0.05}
                    >
                        {sceneContent}
                    </Float>
                ) : (
                    sceneContent
                )}
            </Canvas>

            {/* 国界叠加层降级提示（可关闭；国界数据加载失败时不再静默消失） */}
            {bordersDegraded && (
                <div
                    role="status"
                    className="absolute left-1/2 top-4 z-[6] flex -translate-x-1/2 items-center gap-3 rounded-control border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] px-4 py-2 text-xs font-light text-[var(--text-secondary)]"
                >
                    国界数据加载失败，已省略国界叠加层
                    <button
                        type="button"
                        aria-label="关闭提示"
                        onClick={() => setBordersDegraded(false)}
                        className="shrink-0 hover:opacity-70"
                    >
                        ×
                    </button>
                </div>
            )}

            {/* 状态图例（点击即筛选，chip 置灰表示该状态已隐藏） */}
            <div className="absolute left-5 bottom-5 z-[5] flex flex-col gap-1.5 rounded-inset border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] px-3 py-2.5">
                {GLOBE_STATUS_LEGEND_ORDER.map(status => {
                    const hidden = hiddenStatuses.has(status);
                    return (
                        <button
                            key={status}
                            type="button"
                            onClick={() => toggleStatus(status)}
                            aria-pressed={!hidden}
                            title={hidden ? '点击显示该状态' : '点击隐藏该状态'}
                            className={`flex items-center gap-2 text-left text-xs font-light text-[var(--text-secondary)] transition-opacity ${hidden ? 'opacity-40' : 'opacity-100'}`}
                        >
                            <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: StatusColorMap[status] }}
                            />
                            <span>{GLOBE_STATUS_LABEL_ZH[status]}</span>
                            <span className="tabular-nums text-[var(--text-tertiary)]">{statusCounts[status] || 0}</span>
                        </button>
                    );
                })}
            </div>

            {/* 缩放控件（与滚轮缩放同语义的受控 dolly） */}
            <div className="absolute right-5 bottom-5 z-[5] flex flex-col gap-1.5">
                <button
                    type="button"
                    aria-label="放大"
                    onClick={() => zoomFnRef.current(1)}
                    className="flex h-9 w-9 items-center justify-center rounded-control border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] text-base font-light text-[var(--text-secondary)] transition-colors hover:bg-[var(--recessed-bg-hover)]"
                >
                    +
                </button>
                <button
                    type="button"
                    aria-label="缩小"
                    onClick={() => zoomFnRef.current(-1)}
                    className="flex h-9 w-9 items-center justify-center rounded-control border border-[var(--border-c-subtle)] bg-[var(--recessed-bg)] text-base font-light text-[var(--text-secondary)] transition-colors hover:bg-[var(--recessed-bg-hover)]"
                >
                    −
                </button>
            </div>
        </div>
    );
};

const ProductionGlobe = memo(ProductionGlobeImpl);
export default ProductionGlobe;
