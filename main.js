import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* =========================================
   GLOBAL VARIABLES
   ========================================= */
let scene, camera, renderer, controls;
let particlesMesh; 
const PARTICLE_COUNT = 20000;
const PARTICLE_SIZE = 0.5;

// Data structures to store the shapes
// Each array will hold 60,000 numbers (20,000 particles * x,y,z)
const particles = {
    initial: [],
    sphere: [],
    heart: [],
    cube: [],
    spiral: []
};

// State
let currentShape = 'sphere'; // Default shape

/* =========================================
   INIT
   ========================================= */
function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 300; // Moved back a bit to see larger shapes

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 1. Calculate all shape positions BEFORE creating the mesh
    calculateShapes();

    // 2. Create the particles based on the calculation
    createParticles();

    // 3. Add Event Listener for keys (Temporary Testing)
    window.addEventListener('keydown', onKeyDown);

    window.addEventListener('resize', onWindowResize);
    animate();
}

/* =========================================
   SHAPE CALCULATIONS (The Math)
   ========================================= */
function calculateShapes() {
    
    // We create temporary arrays to hold the positions
    const spherePos = [];
    const cubePos = [];
    const heartPos = [];
    const spiralPos = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        
        // --- SPHERE FORMULA ---
        // Radius of 100
        const r = 100;
        const theta = 2 * Math.PI * Math.random(); // Angle around Y
        const phi = Math.acos(2 * Math.random() - 1); // Angle from pole
        
        const sx = r * Math.sin(phi) * Math.cos(theta);
        const sy = r * Math.sin(phi) * Math.sin(theta);
        const sz = r * Math.cos(phi);
        spherePos.push(sx, sy, sz);

        // --- CUBE FORMULA ---
        // Random point inside a box of size 200 (-100 to 100)
        const amount = 100;
        const cx = (Math.random() - 0.5) * 2 * amount;
        const cy = (Math.random() - 0.5) * 2 * amount;
        const cz = (Math.random() - 0.5) * 2 * amount;
        cubePos.push(cx, cy, cz);

        // --- HEART FORMULA ---
        // A variation of the Swiss Army Knife Heart equation
        // We scale it up by 5 to make it visible
        const scale = 5; 
        // We need a distribution, so we just calculate a parametric point
        // But for a volume, we can use rejection sampling, or just a surface.
        // Let's use a simple 3D parametric heart curve:
        const t = Math.random() * Math.PI * 2; // 0 to 360
        // We add some random variation to fill the volume, not just the outline
        const h_r = (Math.random() * 0.5 + 0.5); // Random radius variation

        // Classic Heart Formula
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
        const hz = Math.random() * 6 - 3; // Thickness in Z

        // Scale and randomize slightly to make it a "cloud"
        heartPos.push(hx * scale * h_r, hy * scale * h_r, hz * scale * 5);


        // --- SPIRAL FORMULA ---
        // A helix
        const spiralRadius = 50;
        const spiralHeight = 400; // Total height
        const turns = 5; 
        
        // 'y' goes from -200 to +200
        const y_spiral = (Math.random() - 0.5) * spiralHeight; 
        // The angle depends on the height (this creates the twist)
        const angle = (y_spiral / spiralHeight) * Math.PI * 2 * turns;
        
        const spx = spiralRadius * Math.cos(angle) + (Math.random()-0.5)*20; // Add noise
        const spz = spiralRadius * Math.sin(angle) + (Math.random()-0.5)*20;
        
        spiralPos.push(spx, y_spiral, spz);
    }

    // Store these in our global object
    particles.sphere = new Float32Array(spherePos);
    particles.cube = new Float32Array(cubePos);
    particles.heart = new Float32Array(heartPos);
    particles.spiral = new Float32Array(spiralPos);
}

/* =========================================
   CREATE PARTICLES
   ========================================= */
function createParticles() {
    const geometry = new THREE.BufferGeometry();

    // Start with the SPHERE shape by default
    geometry.setAttribute('position', new THREE.BufferAttribute(particles.sphere, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
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
   KEYBOARD TESTING
   Press 1, 2, 3, 4 to switch shapes instantly
   ========================================= */
function onKeyDown(event) {
    const geometry = particlesMesh.geometry;
    
    switch(event.key) {
        case '1':
            console.log("Switching to Sphere");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.sphere, 3));
            break;
        case '2':
            console.log("Switching to Cube");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.cube, 3));
            break;
        case '3':
            console.log("Switching to Heart");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.heart, 3));
            break;
        case '4':
            console.log("Switching to Spiral");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.spiral, 3));
            break;
    }
    
    // IMPORTANT: Tell Three.js the position data has changed
    geometry.attributes.position.needsUpdate = true;
}

/* =========================================
   ANIMATE LOOP
   ========================================= */
function animate() {
    requestAnimationFrame(animate);
    
    // Rotate the whole shape slowly
    particlesMesh.rotation.y += 0.002;

    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();