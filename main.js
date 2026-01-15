/* =========================================
   WUHHUU TOUCH - ULTIMATE MAGICAL EDITION
   ========================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// --- POST PROCESSING (THE GLOW) ---
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* =========================================
   GLOBAL CONFIG
   ========================================= */
const settings = {
    count: 30000,          // High particle count for "dust" effect
    size: 0.35,            // Small particles look more magical
    speed: 0.08,           // How fast they return to shape
    force: 8.0,            // Splash strength
    radius: 140,           // Hand interaction size
    bloom: 1.5             // Glow strength
};

// Global State
let scene, camera, renderer, composer, bloomPass, controls;
let particlesMesh;
let p_pos, p_target, p_vel; // Typed Arrays for physics

// Interaction
let handPos = new THREE.Vector3(1000, 1000, 1000); // Start off-screen
let targetCenter = new THREE.Vector3(0, 0, 0); // Shape center
let isHandClosed = false;
let wasHandClosed = false;
let isWebcamRunning = false;
let handLandmarker, video, lastVideoTime = -1;

const shapes = { sphere: null, cube: null, heart: null, star: null };

/* =========================================
   INIT
   ========================================= */
async function init() {
    createScene();
    setupPostProcessing();
    setupUI();
    
    // Calculate the perfect shapes
    calculateShapes();
    
    // Spawn the magic dust
    createParticles();
    
    // Enable the eyes (Webcam)
    await initVision();
    
    window.addEventListener('resize', onWindowResize);
    animate();
}

/* =========================================
   SCENE SETUP
   ========================================= */
function createScene() {
    scene = new THREE.Scene();
    // Deep fog makes particles fade into the void
    scene.fog = new THREE.FogExp2(0x020205, 0.0015); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 350;

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true; // Slowly rotate the camera for cinematic effect
    controls.autoRotateSpeed = 0.5;
}

function setupPostProcessing() {
    const renderScene = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.strength = settings.bloom;
    bloomPass.radius = 0.5; // Spread of the glow

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
}

/* =========================================
   SHAPE MATH (Fixed Star)
   ========================================= */
function calculateShapes() {
    
    // 1. SPHERE
    const s_sphere = [];
    for (let i = 0; i < settings.count; i++) {
        const r = 100 * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        s_sphere.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    }

    // 2. HEART (Volumetric)
    const s_heart = [];
    let h = 0;
    while (h < settings.count) {
        const x = (Math.random() - 0.5) * 3.5;
        const y = (Math.random() - 0.5) * 3.5;
        const z = (Math.random() - 0.5) * 3.5;
        // Heart equation
        if ((x*x + (9/4)*y*y + z*z - 1)**3 - x*x*z**3 - (9/80)*y*y*z**3 < 0) {
            s_heart.push(x * 70, y * 70, z * 70);
            h++;
        }
    }

    // 3. STAR (Fixed: Sharp 5-Point)
    const s_star = [];
    let st = 0;
    const R_outer = 130; // Tip
    const R_inner = 55;  // Valley
    const depth = 25;    // Thickness
    
    while (st < settings.count) {
        // We generate points using Polar Coordinates to ensure sharpness
        
        // 1. Pick a random angle
        const angle = Math.random() * Math.PI * 2;
        
        // 2. Calculate the max radius allowed at this specific angle for a Star
        // Map angle to a 5-slice sector
        const sectorAngle = (Math.PI * 2) / 5;
        const relativeAngle = angle % sectorAngle;
        const foldAngle = Math.abs(relativeAngle - sectorAngle / 2); // 0 at tip, max at valley
        
        // Linear interpolation between Tip and Valley based on angle
        // The denominator 0.6 adjusts the slope to be straight lines
        const maxR = R_outer * (1 - foldAngle*0.8) + R_inner * (foldAngle*0.8); 

        // 3. Pick a random distance inside that max radius (Solid fill)
        const r = Math.sqrt(Math.random()) * maxR; // Sqrt for uniform distribution
        
        // 4. Convert to Cartesian
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        
        // 5. Add Z thickness
        const z = (Math.random() - 0.5) * depth;

        s_star.push(x, y, z);
        st++;
    }

    // 4. CUBE
    const s_cube = [];
    for (let i = 0; i < settings.count; i++) {
        const s = 160;
        s_cube.push((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    shapes.sphere = new Float32Array(s_sphere);
    shapes.heart = new Float32Array(s_heart);
    shapes.star = new Float32Array(s_star);
    shapes.cube = new Float32Array(s_cube);
}

/* =========================================
   PARTICLE SYSTEM
   ========================================= */
function createParticles() {
    const geo = new THREE.BufferGeometry();
    p_pos = new Float32Array(settings.count * 3);
    p_target = new Float32Array(settings.count * 3);
    p_vel = new Float32Array(settings.count * 3);
    const p_color = new Float32Array(settings.count * 3);

    // Initial shape
    p_pos.set(shapes.sphere);
    p_target.set(shapes.sphere);

    // Initial Colors (Galaxy Theme)
    for (let i = 0; i < settings.count; i++) {
        const c = new THREE.Color();
        // Mix of Cyan, Purple, and Deep Blue
        c.setHSL(0.6 + Math.random() * 0.2, 0.9, 0.6); 
        p_color[i*3] = c.r; p_color[i*3+1] = c.g; p_color[i*3+2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(p_pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(p_color, 3));

    const mat = new THREE.PointsMaterial({
        size: settings.size,
        vertexColors: true,
        transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    particlesMesh = new THREE.Points(geo, mat);
    scene.add(particlesMesh);
}

/* =========================================
   PHYSICS ENGINE
   ========================================= */
function updateParticles() {
    if (!particlesMesh) return;
    const pos = particlesMesh.geometry.attributes.position.array;
    const col = particlesMesh.geometry.attributes.color.array;

    for (let i = 0; i < settings.count * 3; i += 3) {
        let px = pos[i], py = pos[i+1], pz = pos[i+2];
        let vx = p_vel[i], vy = p_vel[i+1], vz = p_vel[i+2];

        // 1. Elastic Return to Shape
        // Target moves with hand (targetCenter)
        const tx = p_target[i] + targetCenter.x;
        const ty = p_target[i+1] + targetCenter.y;
        const tz = p_target[i+2] + targetCenter.z;

        vx += (tx - px) * settings.speed;
        vy += (ty - py) * settings.speed;
        vz += (tz - pz) * settings.speed;

        // 2. Hand Interaction
        const dx = px - handPos.x;
        const dy = py - handPos.y;
        const dz = pz - handPos.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        if (distSq < settings.radius * settings.radius) {
            const dist = Math.sqrt(distSq);
            const force = (1 - dist / settings.radius); // Stronger near center

            if (isHandClosed) {
                // GATHER ENERGY (Suck In)
                vx -= (dx / dist) * force * 5.0;
                vy -= (dy / dist) * force * 5.0;
                vz -= (dz / dist) * force * 5.0;
            } else {
                // SHIELD (Gentle Push)
                vx += (dx / dist) * force * 2.0;
                vy += (dy / dist) * force * 2.0;
                vz += (dz / dist) * force * 2.0;
            }
        }

        // 3. Apply Velocity & Friction
        vx *= 0.91; vy *= 0.91; vz *= 0.91; // Smooth friction
        px += vx; py += vy; pz += vz;

        // 4. Dynamic Color (Flash on Speed)
        const speed = Math.sqrt(vx*vx + vy*vy + vz*vz);
        // Base Color
        let r = 0.1, g = 0.2, b = 0.8; 
        
        // If moving fast, turn White/Gold (Energy Flash)
        if (speed > 2.5) {
            const intensity = Math.min((speed - 2.5) * 0.15, 1.0);
            r += intensity * 0.9;
            g += intensity * 0.7;
            b += intensity * 0.2;
        }

        pos[i] = px; pos[i+1] = py; pos[i+2] = pz;
        p_vel[i] = vx; p_vel[i+1] = vy; p_vel[i+2] = vz;
        col[i] = r; col[i+1] = g; col[i+2] = b;
    }

    particlesMesh.geometry.attributes.position.needsUpdate = true;
    particlesMesh.geometry.attributes.color.needsUpdate = true;
}

function triggerSplash() {
    // EXPLOSION LOGIC
    for (let i = 0; i < settings.count * 3; i += 3) {
        // Random blast direction
        p_vel[i] += (Math.random()-0.5) * settings.force * 6;
        p_vel[i+1] += (Math.random()-0.5) * settings.force * 6;
        p_vel[i+2] += (Math.random()-0.5) * settings.force * 6;
    }
}

/* =========================================
                UI & VISION
   ========================================= */
function setupUI() {
    window.setShape = (name) => {
        if(shapes[name]) {
            p_target.set(shapes[name]);
            // Highlight button
            document.querySelectorAll('.button-row button').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
        }
    };
    // Bind Sliders
    document.getElementById('slider-bloom').addEventListener('input', (e) => bloomPass.strength = e.target.value);
    document.getElementById('slider-speed').addEventListener('input', (e) => settings.speed = e.target.value);
    document.getElementById('slider-force').addEventListener('input', (e) => settings.force = e.target.value);
}

async function initVision() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numHands: 1
    });
    
    video = document.getElementById("webcam");
    navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
        video.srcObject = s;
        video.addEventListener("loadeddata", () => isWebcamRunning = true);
    });
}

function detectHands() {
    if (!handLandmarker || !isWebcamRunning) return;
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const res = handLandmarker.detectForVideo(video, performance.now());
        const status = document.getElementById('hand-status');

        if (res.landmarks && res.landmarks.length > 0) {
            status.innerText = "MAGIC LOCKED"; status.classList.add('active');
            
            const lm = res.landmarks[0];
            const p = lm[0];
            const f = lm[9];
            
            // Map 2D -> 3D
            const x = (0.5 - (p.x+f.x)/2) * 500;
            const y = (0.5 - (p.y+f.y)/2) * 400;
            
            targetCenter.lerp(new THREE.Vector3(x, y, 0), 0.15);
            handPos.copy(targetCenter);
            
            // Fist Check
            let d = 0;
            [8,12,16,20].forEach(i => {
                const dx = lm[i].x - lm[0].x, dy = lm[i].y - lm[0].y;
                d += Math.sqrt(dx*dx + dy*dy);
            });
            isHandClosed = (d/4 < 0.22); // Threshold

            // Trigger Blast if we opened hand
            if (wasHandClosed && !isHandClosed) triggerSplash();
            wasHandClosed = isHandClosed;

            // Stop Auto Rotate if interacting
            controls.autoRotate = false;

        } else {
            status.innerText = "SEARCHING FOR HAND..."; status.classList.remove('active');
            targetCenter.lerp(new THREE.Vector3(0,0,0), 0.05);
            handPos.set(1000,1000,1000);
            controls.autoRotate = true; // Resume rotation when idle
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    detectHands();
    updateParticles();
    controls.update();
    composer.render(); // Render with Glow
}

init();