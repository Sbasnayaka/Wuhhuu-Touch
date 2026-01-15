/* =========================================
   WUHHUU TOUCH - MAGICAL EDITION 🌟
   ========================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// --- POST PROCESSING (For the GLOW) ---
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* =========================================
   GLOBAL VARIABLES
   ========================================= */
let scene, camera, renderer, controls;
let composer, bloomPass; // For Glow
let particlesMesh; 

const settings = {
    count: 25000,          // More particles for density
    size: 0.4,             // Smaller for "Dust" look
    speed: 0.08,           // Snappy return
    force: 8.0,            // Big boom
    radius: 140,           // Interaction size
    bloom: 1.5             // Glow strength
};

// Physics Arrays
let p_pos, p_target, p_vel;
const dummy = new THREE.Vector3(); // Helper for math

// Interaction State
let handPos = new THREE.Vector3(1000,1000,1000);
let targetCenter = new THREE.Vector3(0,0,0);
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
    setupPostProcessing(); // Enable the Magic Glow
    setupUI();
    
    calculateShapes();     // Calculate perfect forms
    createParticles();     // Spawn the dust
    
    await initVision();    // Turn on the Eyes
    
    window.addEventListener('resize', onWindowResize);
    animate();
}

/* =========================================
   SCENE & MAGIC VISUALS
   ========================================= */
function createScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.001); // Subtle depth

    camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    camera.position.z = 350;

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = false;
}

function setupPostProcessing() {
    // This pipeline handles the "Glow"
    const renderScene = new RenderPass(scene, camera);
    
    // UnrealBloomPass(resolution, strength, radius, threshold)
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.strength = settings.bloom;
    bloomPass.radius = 0.5;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
}

/* =========================================
   PARTICLE SYSTEM & COLORS
   ========================================= */
function createParticles() {
    const geo = new THREE.BufferGeometry();
    
    p_pos = new Float32Array(settings.count * 3);
    p_target = new Float32Array(settings.count * 3);
    p_vel = new Float32Array(settings.count * 3);
    const p_color = new Float32Array(settings.count * 3); // For dynamic colors

    // Start as Sphere
    p_pos.set(shapes.sphere);
    p_target.set(shapes.sphere);

    // Initial Color (Cyan/Purple Mix)
    for(let i=0; i<settings.count; i++) {
        const color = new THREE.Color();
        color.setHSL(0.6 + Math.random()*0.1, 0.8, 0.5); // Blue-ish
        p_color[i*3] = color.r;
        p_color[i*3+1] = color.g;
        p_color[i*3+2] = color.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(p_pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(p_color, 3));

    const mat = new THREE.PointsMaterial({
        size: settings.size,
        vertexColors: true, // Allow individual particle colors
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending, // Makes overlapping particles brighter
        depthWrite: false
    });

    particlesMesh = new THREE.Points(geo, mat);
    scene.add(particlesMesh);
}

/* =========================================
   PERFECT SHAPE MATH
   ========================================= */
function calculateShapes() {
    // 1. SPHERE
    const s_sphere = [];
    for(let i=0; i<settings.count; i++) {
        const r = 100 * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        s_sphere.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    }

    // 2. HEART (Volumetric & Plump)
    const s_heart = [];
    let h = 0;
    while(h < settings.count) {
        // Broad search range
        const x = (Math.random()-0.5)*3.5;
        const y = (Math.random()-0.5)*3.5; 
        const z = (Math.random()-0.5)*3.5;
        
        // Perfect Heart Equation
        const a = x*x + (9/4)*y*y + z*z - 1;
        if (a*a*a - x*x*z*z*z - (9/80)*y*y*z*z*z < 0) {
            // Scale it up
            s_heart.push(x*70, y*70, z*70);
            h++;
        }
    }

    // 3. STAR (Sharp & 3D)
    const s_star = [];
    let st = 0;
    const R = 130, r = 50, depth = 30; // Outer, Inner, Thickness
    while(st < settings.count) {
        const x = (Math.random()-0.5)*2*R;
        const y = (Math.random()-0.5)*2*R;
        const z = (Math.random()-0.5)*depth; // 3D Thickness

        // Star Check
        const angle = Math.atan2(y, x) + Math.PI/2;
        const dist = Math.sqrt(x*x + y*y);
        const section = (angle + Math.PI*2) % (Math.PI*2/5); // Divide circle into 5 wedges
        // Triangle wave logic to create star points
        // This calculates the max radius at current angle
        const w = Math.PI*2/5;
        const fold = Math.abs((angle % w) - w/2); // 0 at tip, w/2 at inner
        // Linear Interpolation
        const limit = R * (1 - fold/(w/1.8)) + r * (fold/(w/1.8)); // Adjusted slope
        
        if(dist < limit) {
             // Add a "Puff" to the center (thicker in middle)
             const puff = 1 - (dist/R);
             s_star.push(x, y, z * (1 + puff*2));
             st++;
        }
    }

    // 4. CUBE
    const s_cube = [];
    for(let i=0; i<settings.count; i++) {
        const s = 160;
        s_cube.push((Math.random()-0.5)*s, (Math.random()-0.5)*s, (Math.random()-0.5)*s);
    }

    shapes.sphere = new Float32Array(s_sphere);
    shapes.heart = new Float32Array(s_heart);
    shapes.star = new Float32Array(s_star);
    shapes.cube = new Float32Array(s_cube);
}

/* =========================================
   PHYSICS ENGINE (The Heartbeat)
   ========================================= */
function updateParticles() {
    if (!particlesMesh) return;
    
    const pos = particlesMesh.geometry.attributes.position.array;
    const col = particlesMesh.geometry.attributes.color.array;

    for(let i=0; i<settings.count*3; i+=3) {
        let px = pos[i], py = pos[i+1], pz = pos[i+2];
        let vx = p_vel[i], vy = p_vel[i+1], vz = p_vel[i+2];

        // 1. Target Attraction (Elasticity)
        // We move the target relative to the Hand Position (targetCenter)
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

        // Optimized Distance check (avoid sqrt if possible)
        if (distSq < settings.radius * settings.radius) {
            const dist = Math.sqrt(distSq);
            const forceFactor = (1 - dist/settings.radius); // Stronger closer to hand

            if (isHandClosed) {
                // FIST: Gravity Well
                // Pull IN strongly
                vx -= (dx/dist) * forceFactor * 5.0;
                vy -= (dy/dist) * forceFactor * 5.0;
                vz -= (dz/dist) * forceFactor * 5.0;
            } else {
                // OPEN: Repel / Shield
                vx += (dx/dist) * forceFactor * 2.0;
                vy += (dy/dist) * forceFactor * 2.0;
                vz += (dz/dist) * forceFactor * 2.0;
            }
        }

        // 3. Physics Steps
        vx *= 0.90; vy *= 0.90; vz *= 0.90; // Friction
        px += vx; py += vy; pz += vz;

        // 4. Dynamic Coloring (The "Fire" Effect)
        // Calculate speed
        const speed = Math.sqrt(vx*vx + vy*vy + vz*vz);
        
        // Base color (Cool Blue/Purple)
        let r = 0.1, g = 0.3, b = 0.8; 

        // If fast (Blasting), turn Gold/White
        if (speed > 2.0) {
            const heat = Math.min((speed - 2.0) * 0.2, 1.0);
            r += heat * 0.9; // Add Red
            g += heat * 0.6; // Add Green (makes yellow/white)
            b += heat * 0.2;
        }

        pos[i] = px; pos[i+1] = py; pos[i+2] = pz;
        p_vel[i] = vx; p_vel[i+1] = vy; p_vel[i+2] = vz;
        
        col[i] = r; col[i+1] = g; col[i+2] = b;
    }

    particlesMesh.geometry.attributes.position.needsUpdate = true;
    particlesMesh.geometry.attributes.color.needsUpdate = true;
}

function triggerSplash() {
    // The "BOOM" Event
    for(let i=0; i<settings.count*3; i+=3) {
        // Random explosion direction, but biased outwards from center
        const dx = (Math.random()-0.5);
        const dy = (Math.random()-0.5);
        const dz = (Math.random()-0.5);
        
        // Add huge velocity
        p_vel[i] += dx * settings.force * 5; 
        p_vel[i+1] += dy * settings.force * 5; 
        p_vel[i+2] += dz * settings.force * 5; 
    }
}

/* =========================================
   UI & VISION LOGIC
   ========================================= */
function setupUI() {
    window.setShape = (name) => {
        if(shapes[name]) {
            p_target.set(shapes[name]);
            document.querySelectorAll('.button-row button').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
        }
    };
    
    document.getElementById('slider-bloom').addEventListener('input', (e) => bloomPass.strength = parseFloat(e.target.value));
    document.getElementById('slider-speed').addEventListener('input', (e) => settings.speed = parseFloat(e.target.value));
    document.getElementById('slider-force').addEventListener('input', (e) => settings.force = parseFloat(e.target.value));
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
    if(!handLandmarker || !isWebcamRunning) return;
    if(video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const res = handLandmarker.detectForVideo(video, performance.now());
        const status = document.getElementById('hand-status');
        
        if(res.landmarks && res.landmarks.length > 0) {
            status.innerText = "HAND LOCKED"; status.classList.add('active');
            
            const lm = res.landmarks[0];
            const p = lm[0]; // Wrist
            const f = lm[9]; // Middle finger
            
            // Map 2D to 3D Space
            const x = (0.5 - (p.x+f.x)/2) * 500;
            const y = (0.5 - (p.y+f.y)/2) * 400;
            
            // Smooth Follow
            targetCenter.lerp(new THREE.Vector3(x, y, 0), 0.12);
            handPos.copy(targetCenter);
            
            // Fist Detection
            let d = 0;
            [8,12,16,20].forEach(i => {
                const dx = lm[i].x - lm[0].x, dy = lm[i].y - lm[0].y;
                d += Math.sqrt(dx*dx + dy*dy);
            });
            isHandClosed = (d/4 < 0.22); // Threshold

            // Trigger Splash on Open
            if(wasHandClosed && !isHandClosed) triggerSplash();
            wasHandClosed = isHandClosed;

        } else {
            status.innerText = "WAITING..."; status.classList.remove('active');
            targetCenter.lerp(new THREE.Vector3(0,0,0), 0.05); // Return to center
            handPos.set(1000,1000,1000);
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
    // Render with Bloom
    composer.render();
}

init();