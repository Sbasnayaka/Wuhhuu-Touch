/* =========================================
   WUHHUU TOUCH - MAIN.JS
   Final Phase: Physics Integration
   ========================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

/* =========================================
   GLOBAL VARIABLES
   ========================================= */
let scene, camera, renderer, controls;
let particlesMesh; 

// --- PHYSICS DATA ---
// We need extra arrays to store physics state for every particle
let particlePositions;      // Float32Array: Where they are right now (X, Y, Z)
let particleTargets;        // Float32Array: Where they WANT to go (The Shape)
let particleVelocities;     // Float32Array: How fast they are moving (VX, VY, VZ)

const PARTICLE_COUNT = 20000;
const PARTICLE_SIZE = 0.6;  // Slightly larger for visibility

// Physics Parameters
const FRICTION = 0.90;      // Slows down particles (0.9 = loses 10% speed per frame)
const RETURN_STRENGTH = 0.05; // How strong the "rubber band" is snapping back to shape
const HAND_RADIUS = 100;    // How big is the interaction area around the hand
const REPULSE_FORCE = 5.0;  // How hard the open hand pushes
const ATTRACT_FORCE = 3.0;  // How hard the fist pulls

// --- VISION VARIABLES ---
let handLandmarker = undefined;
let video = undefined;
let lastVideoTime = -1;
let isWebcamRunning = false;
let handPosition = new THREE.Vector3(1000, 1000, 1000); // Start far away so it doesn't disturb particles
let isHandClosed = false; 
let debugSphere; 

// Shape Data Storage
const shapes = {
    sphere: null,
    cube: null,
    heart: null,
    star: null
};

/* =========================================
   INIT
   ========================================= */
async function init() {
    createScene();
    
    // 1. Calculate all shapes once
    calculateShapes();
    
    // 2. Initialize the particle system with physics arrays
    createParticles();
    
    // 3. Setup Debug Marker
    const debugGeo = new THREE.SphereGeometry(5, 16, 16);
    const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
    debugSphere = new THREE.Mesh(debugGeo, debugMat);
    scene.add(debugSphere);

    // 4. Input & Resize
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);

    // 5. Load AI
    console.log("Loading Vision AI...");
    await initMediaPipe();

    // 6. Start Loop
    animate();
}

/* =========================================
   SCENE SETUP
   ========================================= */
function createScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 400; 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = false; // Disable auto rotate so it doesn't fight the user
}

/* =========================================
   SHAPE CALCULATIONS
   ========================================= */
function calculateShapes() {
    const spherePos = [];
    const cubePos = [];
    const heartPos = [];
    const starPos = [];

    // --- SPHERE ---
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const r = 120 * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        spherePos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    }
    
    // --- CUBE ---
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const size = 200;
        cubePos.push((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
    }
    
    // --- HEART (Solid) ---
    let hCount = 0;
    while (hCount < PARTICLE_COUNT) {
        const x = (Math.random() - 0.5) * 4; 
        const y = (Math.random() - 0.5) * 4;
        const z = (Math.random() - 0.5) * 2; 
        const a = x * x + (9/4) * y * y + z * z - 1;
        if ((a * a * a) - (x * x * z * z * z) - (9/80) * (y * y * z * z * z) < 0) {
            const scale = 100;
            heartPos.push(x * scale, y * scale, z * scale); 
            hCount++;
        }
    }
    
    // --- STAR (Solid) ---
    let sCount = 0;
    const outerRadius = 150, innerRadius = 60, thickness = 60;
    while (sCount < PARTICLE_COUNT) {
        const x = (Math.random() - 0.5) * 2 * outerRadius;
        const y = (Math.random() - 0.5) * 2 * outerRadius;
        if (isInsideStar(x, y, outerRadius, innerRadius)) {
            starPos.push(x, y, (Math.random() - 0.5) * thickness);
            sCount++;
        }
    }

    // Convert to Typed Arrays
    shapes.sphere = new Float32Array(spherePos);
    shapes.cube = new Float32Array(cubePos);
    shapes.heart = new Float32Array(heartPos);
    shapes.star = new Float32Array(starPos);
}

function isInsideStar(x, y, R, r) {
    let a = Math.atan2(y, x) + Math.PI / 2;
    const l = Math.sqrt(x*x + y*y);
    const w = (Math.PI * 2) / 5;
    a = (a + Math.PI * 2) % (Math.PI * 2);
    let angleInWedge = a % w;
    if (angleInWedge > w / 2) angleInWedge = w - angleInWedge;
    const limit = R * (1 - angleInWedge / (w/2)) + r * (angleInWedge / (w/2));
    return l < limit;
}

/* =========================================
   CREATE PARTICLES & PHYSICS ARRAYS
   ========================================= */
function createParticles() {
    const geometry = new THREE.BufferGeometry();

    // 1. Initialize Typed Arrays
    particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    particleTargets = new Float32Array(PARTICLE_COUNT * 3);
    particleVelocities = new Float32Array(PARTICLE_COUNT * 3);

    // 2. Set Initial State (Start as Sphere)
    // copy within creates a fast copy of the data
    particlePositions.set(shapes.sphere); 
    particleTargets.set(shapes.sphere);

    // 3. Set Attributes
    geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    
    const material = new THREE.PointsMaterial({
        color: 0x44aaff, // Cyan-ish color for "Wuhhuu" vibe
        size: PARTICLE_SIZE,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    particlesMesh = new THREE.Points(geometry, material);
    scene.add(particlesMesh);
}

/* =========================================
   MEDIAPIPE & WEBCAM
   ========================================= */
async function initMediaPipe() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
        });
        startWebcam();
    } catch (e) { console.error(e); }
}

function startWebcam() {
    video = document.getElementById("webcam");
    navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", () => { isWebcamRunning = true; });
    });
}

function detectHands() {
    if (!handLandmarker || !isWebcamRunning) return;
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = handLandmarker.detectForVideo(video, performance.now());

        if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0];
            
            // Calculate center
            const palm = landmarks[0];
            const finger = landmarks[9];
            const rawX = (palm.x + finger.x) / 2;
            const rawY = (palm.y + finger.y) / 2;

            // Map to 3D Space (Scaled to fit the camera Z=400 view)
            const x = (0.5 - rawX) * 500; 
            const y = (0.5 - rawY) * 400;
            
            // Smooth movement
            handPosition.lerp(new THREE.Vector3(x, y, 0), 0.15);

            // Fist Detection
            const tips = [8, 12, 16, 20];
            let dist = 0;
            tips.forEach(t => {
                const dx = landmarks[t].x - landmarks[0].x;
                const dy = landmarks[t].y - landmarks[0].y;
                dist += Math.sqrt(dx*dx + dy*dy);
            });
            
            // If fingers are close to palm = Fist
            if (dist / 4 < 0.25) {
                isHandClosed = true;
                debugSphere.material.color.setHex(0xff0000); // Red
            } else {
                isHandClosed = false;
                debugSphere.material.color.setHex(0x00ff00); // Green
            }
        } else {
            // If no hand, move target away so it doesn't interfere
            handPosition.set(1000, 1000, 1000);
        }
    }
}

/* =========================================
   ANIMATION & PHYSICS LOOP
   ========================================= */
function animate() {
    requestAnimationFrame(animate);
    
    detectHands();
    debugSphere.position.copy(handPosition);

    // --- PHYSICS ENGINE ---
    updateParticles();

    controls.update();
    renderer.render(scene, camera);
}

function updateParticles() {
    // Access the live position buffer
    const positions = particlesMesh.geometry.attributes.position.array;
    
    // We loop through all 20,000 particles
    // i is the index for X. i+1 is Y. i+2 is Z.
    for (let i = 0; i < PARTICLE_COUNT * 3; i += 3) {
        
        // 1. Current Position
        const px = positions[i];
        const py = positions[i + 1];
        const pz = positions[i + 2];

        // 2. Target Position (Shape Home)
        const tx = particleTargets[i];
        const ty = particleTargets[i + 1];
        const tz = particleTargets[i + 2];

        // 3. Velocity (Momentum)
        let vx = particleVelocities[i];
        let vy = particleVelocities[i + 1];
        let vz = particleVelocities[i + 2];

        // --- FORCE 1: RETURN TO SHAPE (Spring) ---
        // Calculate vector from Current to Target
        vx += (tx - px) * RETURN_STRENGTH;
        vy += (ty - py) * RETURN_STRENGTH;
        vz += (tz - pz) * RETURN_STRENGTH;

        // --- FORCE 2: HAND INTERACTION ---
        // Calculate distance to hand
        const dx = px - handPosition.x;
        const dy = py - handPosition.y;
        const dz = pz - handPosition.z;
        const distSq = dx*dx + dy*dy + dz*dz; // Distance Squared (Faster than Sqrt)
        
        // Only affect particles within range
        if (distSq < HAND_RADIUS * HAND_RADIUS) {
            const dist = Math.sqrt(distSq);
            // Normalized direction vector (from hand to particle)
            const nx = dx / dist;
            const ny = dy / dist;
            const nz = dz / dist;

            if (isHandClosed) {
                // FIST: Attract (Pull IN)
                // -nx means "towards center"
                const force = ATTRACT_FORCE * (1 - dist/HAND_RADIUS);
                vx -= nx * force;
                vy -= ny * force;
                vz -= nz * force;
            } else {
                // OPEN: Repel (Push OUT)
                // +nx means "away from center"
                const force = REPULSE_FORCE * (1 - dist/HAND_RADIUS);
                vx += nx * force * 3; // Push stronger than pull
                vy += ny * force * 3;
                vz += nz * force * 3;
            }
        }

        // --- APPLY PHYSICS ---
        // Apply friction (air resistance)
        vx *= FRICTION;
        vy *= FRICTION;
        vz *= FRICTION;

        // Update Position
        positions[i] = px + vx;
        positions[i + 1] = py + vy;
        positions[i + 2] = pz + vz;

        // Save Velocity for next frame
        particleVelocities[i] = vx;
        particleVelocities[i + 1] = vy;
        particleVelocities[i + 2] = vz;
    }

    // Tell Three.js the array has changed and needs to be re-uploaded to GPU
    particlesMesh.geometry.attributes.position.needsUpdate = true;
}

/* =========================================
   INPUT
   ========================================= */
function onKeyDown(event) {
    // When we switch shapes, we DON'T teleport particles.
    // We simply update the 'particleTargets' array.
    // The physics loop will naturally fly them to the new home.
    
    switch(event.key) {
        case '1': particleTargets.set(shapes.sphere); break;
        case '2': particleTargets.set(shapes.cube); break;
        case '3': particleTargets.set(shapes.heart); break;
        case '4': particleTargets.set(shapes.star); break;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start
init();