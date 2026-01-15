/* =========================================
   WUHHUU TOUCH - MAIN.JS
   Upgrade: Splash, Locked Tracking, UI Control
   ========================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

/* =========================================
   GLOBAL VARIABLES & CONFIG
   ========================================= */
let scene, camera, renderer, controls;
let particlesMesh; 

// --- SETTINGS (Controlled by UI) ---
const settings = {
    particleCount: 20000,
    size: 0.6,
    returnSpeed: 0.05,     // How fast they fly back to shape
    explodeForce: 5.0,     // How hard the splash is
    handRadius: 120        // Interaction radius
};

// --- PHYSICS ARRAYS ---
let particlePositions;      // Current X,Y,Z
let particleTargets;        // Base Shape X,Y,Z (Relative to center)
let particleVelocities;     // Velocity X,Y,Z

// --- INTERACTION STATE ---
let handPosition = new THREE.Vector3(1000, 1000, 1000); // Default far away
let targetCenter = new THREE.Vector3(0, 0, 0); // The center of the shape (follows hand)
let isHandClosed = false;
let wasHandClosed = false; // To detect the "Edge" (Moment of opening)
let isWebcamRunning = false;

// --- VISION ---
let handLandmarker, video, lastVideoTime = -1;

// --- SHAPE STORAGE ---
const shapes = { sphere: null, cube: null, heart: null, star: null };

/* =========================================
   INIT
   ========================================= */
async function init() {
    createScene();
    setupUI();
    
    // 1. Math: Pre-calculate all shapes
    calculateShapes();
    
    // 2. Visuals: Create the particle system
    createParticles();
    
    // 3. AI: Load MediaPipe
    await initMediaPipe();

    // 4. Resize Handling
    window.addEventListener('resize', onWindowResize);

    // 5. Start Loop
    animate();
}

/* =========================================
   SCENE SETUP
   ========================================= */
function createScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.002); // Deep space fog

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 400; 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = false;
}

/* =========================================
   UI CONNECTION
   ========================================= */
function setupUI() {
    // We bind the HTML sliders to our 'settings' object
    
    document.getElementById('slider-size').addEventListener('input', (e) => {
        settings.size = parseFloat(e.target.value);
        particlesMesh.material.size = settings.size;
    });

    document.getElementById('slider-speed').addEventListener('input', (e) => {
        settings.returnSpeed = parseFloat(e.target.value);
    });

    document.getElementById('slider-force').addEventListener('input', (e) => {
        settings.explodeForce = parseFloat(e.target.value);
    });

    // Global function for HTML buttons to call
    window.setShape = (shapeName) => {
        if (shapes[shapeName]) {
            // Update the Target positions to the new shape
            particleTargets.set(shapes[shapeName]);
            
            // Update UI Button Styles
            document.querySelectorAll('.button-row button').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
        }
    };
}

/* =========================================
   SHAPE CALCULATIONS (Relative to 0,0,0)
   ========================================= */
function calculateShapes() {
    // Temporary arrays
    const s_sphere = [], s_cube = [], s_heart = [], s_star = [];

    // SPHERE
    for (let i = 0; i < settings.particleCount; i++) {
        const r = 100 * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        s_sphere.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    }
    // CUBE
    for (let i = 0; i < settings.particleCount; i++) {
        const s = 180;
        s_cube.push((Math.random()-0.5)*s, (Math.random()-0.5)*s, (Math.random()-0.5)*s);
    }
    // HEART (Solid)
    let h = 0;
    while (h < settings.particleCount) {
        const x = (Math.random()-0.5)*4, y = (Math.random()-0.5)*4, z = (Math.random()-0.5)*2;
        if ((x*x + 2.25*y*y + z*z - 1)**3 - x*x*z**3 - 0.1125*y*y*z**3 < 0) {
            s_heart.push(x*90, y*90, z*90); h++;
        }
    }
    // STAR
    let st = 0;
    const R=140, r=50;
    while (st < settings.particleCount) {
        const x = (Math.random()-0.5)*2*R, y = (Math.random()-0.5)*2*R;
        if (isInsideStar(x,y,R,r)) { s_star.push(x, y, (Math.random()-0.5)*50); st++; }
    }

    shapes.sphere = new Float32Array(s_sphere);
    shapes.cube = new Float32Array(s_cube);
    shapes.heart = new Float32Array(s_heart);
    shapes.star = new Float32Array(s_star);
}
function isInsideStar(x, y, R, r) {
    let a = (Math.atan2(y, x) + Math.PI/2 + Math.PI*2) % (Math.PI*2);
    let w = Math.PI*2/5, aw = a % w;
    if (aw > w/2) aw = w - aw;
    return Math.sqrt(x*x+y*y) < (R*(1-aw/(w/2)) + r*(aw/(w/2)));
}

/* =========================================
   PARTICLE SYSTEM SETUP
   ========================================= */
function createParticles() {
    const geometry = new THREE.BufferGeometry();
    
    // Initialize Float32Arrays
    particlePositions = new Float32Array(settings.particleCount * 3);
    particleVelocities = new Float32Array(settings.particleCount * 3);
    particleTargets = new Float32Array(settings.particleCount * 3);

    // Start with Sphere
    particlePositions.set(shapes.sphere);
    particleTargets.set(shapes.sphere);

    geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    
    const material = new THREE.PointsMaterial({
        color: 0x44aaff,
        size: settings.size,
        transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false
    });

    particlesMesh = new THREE.Points(geometry, material);
    scene.add(particlesMesh);
}

/* =========================================
   VISION & TRACKING
   ========================================= */
async function initMediaPipe() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO", numHands: 1
    });
    startWebcam();
}

function startWebcam() {
    video = document.getElementById("webcam");
    navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
        video.srcObject = s;
        video.addEventListener("loadeddata", () => { isWebcamRunning = true; });
    });
}

function detectHands() {
    if (!handLandmarker || !isWebcamRunning) return;
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const res = handLandmarker.detectForVideo(video, performance.now());

        const statusDiv = document.getElementById('hand-status');

        if (res.landmarks && res.landmarks.length > 0) {
            // Hand Found!
            statusDiv.innerText = "HAND DETECTED";
            statusDiv.classList.add('active');

            const lm = res.landmarks[0];
            const p = lm[0]; // Palm
            const f = lm[9]; // Middle finger

            // Map 2D -> 3D
            const x = (0.5 - (p.x+f.x)/2) * 500;
            const y = (0.5 - (p.y+f.y)/2) * 400;
            
            // Move the "Target Center" to the hand
            // Using lerp for smooth following
            targetCenter.lerp(new THREE.Vector3(x, y, 0), 0.1);
            
            // Update global hand position for physics
            handPosition.copy(targetCenter);

            // Check Fist (Distance between tips and wrist)
            let d = 0; 
            [8,12,16,20].forEach(i => {
                const dx = lm[i].x - lm[0].x, dy = lm[i].y - lm[0].y;
                d += Math.sqrt(dx*dx + dy*dy);
            });

            isHandClosed = (d/4 < 0.25); // Threshold for fist

            // --- SPLASH TRIGGER ---
            // If hand WAS closed, and NOW is open -> SPLASH!
            if (wasHandClosed && !isHandClosed) {
                triggerSplash();
            }
            
            // Update state for next frame
            wasHandClosed = isHandClosed;

        } else {
            statusDiv.innerText = "Waiting for Hand...";
            statusDiv.classList.remove('active');
            // Move center back to 0,0,0 if hand lost
            targetCenter.lerp(new THREE.Vector3(0,0,0), 0.05);
            handPosition.set(1000,1000,1000); // Move "Force" away
        }
    }
}

/* =========================================
   PHYSICS ENGINE
   ========================================= */
function triggerSplash() {
    // Add a massive outward velocity to all particles
    for (let i = 0; i < settings.particleCount * 3; i += 3) {
        // Calculate direction from center
        const px = particlePositions[i];
        const py = particlePositions[i+1];
        const pz = particlePositions[i+2];

        const dx = px - targetCenter.x;
        const dy = py - targetCenter.y;
        const dz = pz - targetCenter.z;

        // Normalize
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
        
        // Explosion Force!
        particleVelocities[i] += (dx/len) * settings.explodeForce * 5;
        particleVelocities[i+1] += (dy/len) * settings.explodeForce * 5;
        particleVelocities[i+2] += (dz/len) * settings.explodeForce * 5;
    }
}

function updateParticles() {
    const pos = particlesMesh.geometry.attributes.position.array;
    
    for (let i = 0; i < settings.particleCount * 3; i += 3) {
        
        // Current Physics State
        let px = pos[i], py = pos[i+1], pz = pos[i+2];
        let vx = particleVelocities[i], vy = particleVelocities[i+1], vz = particleVelocities[i+2];

        // 1. Calculate TARGET Position (Base Shape + Hand Offset)
        // This makes the whole shape move with the hand
        const tx = particleTargets[i] + targetCenter.x;
        const ty = particleTargets[i+1] + targetCenter.y;
        const tz = particleTargets[i+2] + targetCenter.z;

        // 2. Spring Force (Pull towards Target)
        vx += (tx - px) * settings.returnSpeed;
        vy += (ty - py) * settings.returnSpeed;
        vz += (tz - pz) * settings.returnSpeed;

        // 3. Hand Interaction (Fist/Open)
        const dx = px - handPosition.x;
        const dy = py - handPosition.y;
        const dz = pz - handPosition.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        if (distSq < settings.handRadius * settings.handRadius) {
            const dist = Math.sqrt(distSq);
            const nx = dx/dist, ny = dy/dist, nz = dz/dist; // Normal vector

            if (isHandClosed) {
                // FIST: Black Hole (Suck in)
                const f = 2.0 * (1 - dist/settings.handRadius);
                vx -= nx * f; vy -= ny * f; vz -= nz * f;
            } else {
                // OPEN: Gentle Expansion / Repel
                // We use less force here because we have the SPLASH event for big moves
                const f = 1.0 * (1 - dist/settings.handRadius);
                vx += nx * f; vy += ny * f; vz += nz * f;
            }
        }

        // 4. Apply Velocity & Friction
        const friction = 0.92; // Slidey
        vx *= friction; vy *= friction; vz *= friction;

        pos[i] += vx; pos[i+1] += vy; pos[i+2] += vz;

        // Store new velocity
        particleVelocities[i] = vx; particleVelocities[i+1] = vy; particleVelocities[i+2] = vz;
    }

    particlesMesh.geometry.attributes.position.needsUpdate = true;
}

/* =========================================
   ANIMATION LOOP
   ========================================= */
function animate() {
    requestAnimationFrame(animate);
    
    detectHands();
    updateParticles();
    
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();