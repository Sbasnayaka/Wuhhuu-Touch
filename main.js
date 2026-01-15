import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

/* =========================================
   GLOBAL VARIABLES
   ========================================= */
let scene, camera, renderer, controls;
let particlesMesh; 

// --- VISION VARIABLES ---
let handLandmarker = undefined;
let video = undefined;
let lastVideoTime = -1;
let isWebcamRunning = false;

// Interaction State
let handPosition = new THREE.Vector3(0, 0, 0); // Where is the hand in 3D?
let isHandClosed = false; // Fist or Open?
let debugSphere; // A red ball to visualize where the code thinks your hand is

// Configuration
const PARTICLE_COUNT = 20000;
const PARTICLE_SIZE = 0.5;

// Data structures for shapes
const particles = {
    initial: [],
    sphere: [],
    heart: [],
    cube: [],
    star: []
};

let currentShape = 'sphere'; 

/* =========================================
   INIT: THE SETUP
   ========================================= */
async function init() {
    // 1. Setup Three.js Scene
    createScene();

    // 2. Setup Particles & Shapes (From Phase 3)
    calculateShapes();
    createParticles();

    // 3. Create a Debug Marker (The Red Ball)
    // This helps us see if tracking is working before we move the particles
    const debugGeo = new THREE.SphereGeometry(5, 32, 32);
    const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    debugSphere = new THREE.Mesh(debugGeo, debugMat);
    scene.add(debugSphere);

    // 4. Setup Input
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);

    // 5. Initialize AI Vision (Async)
    console.log("Loading MediaPipe Vision...");
    await initMediaPipe();

    // 6. Start Loop
    animate();
}

/* =========================================
   THREE.JS SCENE SETUP
   ========================================= */
function createScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 300; 

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
}

/* =========================================
   MEDIAPIPE VISION SETUP
   ========================================= */
async function initMediaPipe() {
    try {
        // Load the WASM files (The AI Brain)
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );

        // Configure the Hand Tracker
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU" // Use Graphics Card for speed
            },
            runningMode: "VIDEO",
            numHands: 1
        });

        console.log("MediaPipe Loaded. Starting Webcam...");
        startWebcam();

    } catch (error) {
        console.error("Error loading MediaPipe:", error);
    }
}

function startWebcam() {
    video = document.getElementById("webcam");
    
    // Request Camera Access
    const constraints = { video: true };
    
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", () => {
            isWebcamRunning = true;
            console.log("Webcam is running!");
        });
    });
}

/* =========================================
   DETECTION LOOP
   This runs every frame to update handPosition
   ========================================= */
function detectHands() {
    if (!handLandmarker || !isWebcamRunning) return;

    // Only process if video frame has changed
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        
        // Run detection
        const results = handLandmarker.detectForVideo(video, performance.now());

        if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0]; // Get first hand
            
            // 1. Calculate Center of Hand (Approximation using Wrist & Middle Finger)
            // Landmarks: 0 = Wrist, 9 = Middle Finger MCP
            const palmBase = landmarks[0];
            const middleFingerBase = landmarks[9];
            
            // Raw Coordinates (0 to 1)
            const rawX = (palmBase.x + middleFingerBase.x) / 2;
            const rawY = (palmBase.y + middleFingerBase.y) / 2;

            // 2. Map to 3D World Coordinates
            // Video X is 0(left)-1(right). In 3D, we want -X to +X. 
            // Also, webcam is mirrored, so we invert X: (1 - rawX)
            // Video Y is 0(top)-1(bottom). In 3D, Y is up, so we invert Y: (1 - rawY)
            
            // Multipliers (300 and 200) scale it to fit our camera view at z=300
            const x = (0.5 - rawX) * 400; // Wider range for X
            const y = (0.5 - rawY) * 300; // Range for Y
            
            // Smoothly interpolate current hand position to new position (avoids jitter)
            handPosition.lerp(new THREE.Vector3(x, y, 0), 0.1);

            // 3. Detect "Fist" vs "Open"
            // We measure distance between tips and wrist
            const tips = [8, 12, 16, 20]; // Index, Middle, Ring, Pinky tips
            let totalDist = 0;
            
            tips.forEach(tipIdx => {
                const tip = landmarks[tipIdx];
                // Euclidean distance to wrist (landmark 0)
                const d = Math.sqrt(
                    Math.pow(tip.x - landmarks[0].x, 2) + 
                    Math.pow(tip.y - landmarks[0].y, 2)
                );
                totalDist += d;
            });
            
            const avgDist = totalDist / 4;
            
            // Threshold: If fingers are curled, average distance is small (~0.2 or less)
            if (avgDist < 0.25) {
                isHandClosed = true;
                debugSphere.material.color.setHex(0xff0000); // Red = Fist (Pull)
            } else {
                isHandClosed = false;
                debugSphere.material.color.setHex(0x00ff00); // Green = Open (Push)
            }

        } else {
            // No hand detected - Move target out of way or center?
            // Let's keep it where it was
        }
    }
}

/* =========================================
   ANIMATE LOOP
   ========================================= */
function animate() {
    requestAnimationFrame(animate);
    
    // 1. Run AI Detection
    detectHands();

    // 2. Update Debug Sphere
    debugSphere.position.copy(handPosition);

    // 3. Gentle Rotation of Particles
    particlesMesh.rotation.y += 0.002;
    particlesMesh.rotation.x += 0.001;

    controls.update();
    renderer.render(scene, camera);
}

/* =========================================
   SHAPE CALCULATIONS (Phase 3 Memory)
   ========================================= */
function calculateShapes() {
    const spherePos = [];
    const cubePos = [];
    const heartPos = [];
    const starPos = [];

    // 1. Sphere
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const r = 100 * Math.cbrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        spherePos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    }
    // 2. Cube
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const size = 150;
        cubePos.push((Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
    }
    // 3. Heart (Solid)
    let hCount = 0;
    while (hCount < PARTICLE_COUNT) {
        const x = (Math.random() - 0.5) * 4; 
        const y = (Math.random() - 0.5) * 4;
        const z = (Math.random() - 0.5) * 2; 
        const a = x * x + (9/4) * y * y + z * z - 1;
        if ((a * a * a) - (x * x * z * z * z) - (9/80) * (y * y * z * z * z) < 0) {
            const scale = 80;
            heartPos.push(x * scale, y * scale, z * scale); 
            hCount++;
        }
    }
    // 4. Star (Solid)
    let sCount = 0;
    const outerRadius = 100, innerRadius = 40, thickness = 40;
    while (sCount < PARTICLE_COUNT) {
        const x = (Math.random() - 0.5) * 2 * outerRadius;
        const y = (Math.random() - 0.5) * 2 * outerRadius;
        if (isInsideStar(x, y, outerRadius, innerRadius)) {
            starPos.push(x, y, (Math.random() - 0.5) * thickness);
            sCount++;
        }
    }

    particles.sphere = new Float32Array(spherePos);
    particles.cube = new Float32Array(cubePos);
    particles.heart = new Float32Array(heartPos);
    particles.star = new Float32Array(starPos);
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

function createParticles() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(particles.sphere, 3));
    const material = new THREE.PointsMaterial({
        color: 0xffffff, size: PARTICLE_SIZE, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    particlesMesh = new THREE.Points(geometry, material);
    scene.add(particlesMesh);
}

/* =========================================
   UTILITIES
   ========================================= */
function onKeyDown(event) {
    const geometry = particlesMesh.geometry;
    switch(event.key) {
        case '1': geometry.setAttribute('position', new THREE.BufferAttribute(particles.sphere, 3)); break;
        case '2': geometry.setAttribute('position', new THREE.BufferAttribute(particles.cube, 3)); break;
        case '3': geometry.setAttribute('position', new THREE.BufferAttribute(particles.heart, 3)); break;
        case '4': geometry.setAttribute('position', new THREE.BufferAttribute(particles.star, 3)); break;
    }
    geometry.attributes.position.needsUpdate = true;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start Application
init();