import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* =========================================
   GLOBAL VARIABLES
   ========================================= */
let scene, camera, renderer, controls;
let particlesMesh; 

// Configuration
const PARTICLE_COUNT = 20000;
const PARTICLE_SIZE = 0.5;

// Data structures to store the target positions for each shape
const particles = {
    initial: [], // Random starting noise
    sphere: [],
    heart: [],
    cube: [],
    star: []     // Changed from Spiral to Star
};

// Current state
let currentShape = 'sphere'; 

/* =========================================
   INIT: THE SETUP
   ========================================= */
function init() {
    // 1. Setup Scene
    scene = new THREE.Scene();
    // Dark fog creates depth (particles fade out in the distance)
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    // 2. Setup Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 300; 

    // 3. Setup Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 4. Setup Controls (Mouse)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 5. MATH: Calculate all the shape positions immediately
    console.log("Calculating shapes...");
    calculateShapes();

    // 6. VISUALS: Create the particle system
    createParticles();

    // 7. INPUT: Keyboard listener for testing (Keys 1-4)
    window.addEventListener('keydown', onKeyDown);
    
    // 8. RESIZE: Handle window resizing
    window.addEventListener('resize', onWindowResize);

    // 9. START
    animate();
}

/* =========================================
   SHAPE CALCULATIONS (The "Sculpting" Phase)
   ========================================= */
function calculateShapes() {
    
    // Arrays to hold the x,y,z coordinates
    const spherePos = [];
    const cubePos = [];
    const heartPos = [];
    const starPos = [];

    // --- 1. SPHERE (Solid) ---
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const r = 100 * Math.cbrt(Math.random()); // cbrt ensures uniform volume filling
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        spherePos.push(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );
    }

    // --- 2. CUBE (Solid) ---
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const size = 150;
        cubePos.push(
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size,
            (Math.random() - 0.5) * size
        );
    }

    // --- 3. HEART (Solid Volume - Rejection Sampling) ---
    // We try random points until we find enough that fit inside the heart formula.
    let hCount = 0;
    while (hCount < PARTICLE_COUNT) {
        // Pick a random point in a box around the heart
        // Range: x[-2, 2], y[-2, 2], z[-1, 1] scaled up later
        const x = (Math.random() - 0.5) * 4; 
        const y = (Math.random() - 0.5) * 4;
        const z = (Math.random() - 0.5) * 2; 

        // The Famous 3D Heart Equation: (x^2 + 9y^2/4 + z^2 - 1)^3 - x^2z^3 - 9y^2z^3/80 < 0
        const a = x * x + (9/4) * y * y + z * z - 1;
        const result = (a * a * a) - (x * x * z * z * z) - (9/80) * (y * y * z * z * z);

        // If result is negative, the point is INSIDE the heart
        if (result < 0) {
            const scale = 80; // Scale up to be visible in scene
            // Flip Y because Three.js Y-axis is up, but equation is often flipped
            heartPos.push(x * scale, y * scale, z * scale); 
            hCount++;
        }
    }

    // --- 4. STAR (Solid Extruded) ---
    // A 5-pointed star is defined by Inner Radius and Outer Radius.
    let sCount = 0;
    const outerRadius = 100;
    const innerRadius = 40;
    const thickness = 40;

    while (sCount < PARTICLE_COUNT) {
        // 1. Pick random X, Y
        const x = (Math.random() - 0.5) * 2 * outerRadius;
        const y = (Math.random() - 0.5) * 2 * outerRadius;
        
        // 2. Calculate Polar Angle & Distance
        const angle = Math.atan2(y, x);
        const dist = Math.sqrt(x*x + y*y);

        // 3. Normalize angle for 5 points
        // This math folds the circle into 5 identical pizza slices
        const step = (Math.PI * 2) / 5;
        // Shift angle to align point upwards
        const localAngle = ((angle + Math.PI/2) % step); 
        // Mirror the slice to make it symmetrical
        const fold = Math.abs(localAngle - step/2);
        
        // 4. Calculate the boundary radius at this specific angle
        // It's a linear line between inner and outer radius
        // The secant term makes the lines straight instead of curved
        const maxR = (innerRadius * outerRadius) / 
                     (innerRadius * Math.cos(fold) + (outerRadius-innerRadius)*Math.cos(step/2 - fold) * 0.2); // Simplified approximation for "puffy" star or use straight math
        
        // For a sharp straight-line star, we can use simple interpolation:
        // We map the fold (0 to step/2) to the radius (outer to inner)
        // But let's use a simpler visual check:
        // If distance is less than the interpolated radius, we are inside.
        
        // Simplified "Geometric" Star logic:
        const starCheck = isInsideStar(x, y, outerRadius, innerRadius);
        
        if (starCheck) {
            // Add Z thickness (random depth)
            const z = (Math.random() - 0.5) * thickness;
            starPos.push(x, y, z);
            sCount++;
        }
    }

    // Convert regular arrays to Float32Array (Required for Three.js performance)
    particles.sphere = new Float32Array(spherePos);
    particles.cube = new Float32Array(cubePos);
    particles.heart = new Float32Array(heartPos);
    particles.star = new Float32Array(starPos);
}

// Helper for Star Math
function isInsideStar(x, y, R, r) {
    // Calculate angle and map it to 0-5
    let a = Math.atan2(y, x) + Math.PI / 2;
    const l = Math.sqrt(x*x + y*y);
    const w = (Math.PI * 2) / 5;
    
    // Modulo to get into one "slice"
    a = (a + Math.PI * 2) % (Math.PI * 2);
    
    // Normalize angle within the wedge
    let angleInWedge = a % w;
    if (angleInWedge > w / 2) angleInWedge = w - angleInWedge; // Fold it
    
    // Polar equation for a straight line connecting Outer(R) and Inner(r)
    // The radius at specific angle 'theta' for a line segment
    const interp = angleInWedge / (w/2); // 0 (tip) to 1 (inner valley)
    
    // Simple Linear Interpolation for radius check (Straight lines)
    const limit = R * (1 - interp) + r * interp;
    
    return l < limit;
}

/* =========================================
   CREATE PARTICLES
   ========================================= */
function createParticles() {
    const geometry = new THREE.BufferGeometry();
    
    // Start with Sphere
    geometry.setAttribute('position', new THREE.BufferAttribute(particles.sphere, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: PARTICLE_SIZE,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending, // Makes them glow when stacked
        depthWrite: false
    });

    particlesMesh = new THREE.Points(geometry, material);
    scene.add(particlesMesh);
}

/* =========================================
   KEYBOARD CONTROLS (TESTING)
   ========================================= */
function onKeyDown(event) {
    const geometry = particlesMesh.geometry;
    
    switch(event.key) {
        case '1':
            console.log("Shape: Sphere");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.sphere, 3));
            break;
        case '2':
            console.log("Shape: Cube");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.cube, 3));
            break;
        case '3':
            console.log("Shape: Heart (Solid)");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.heart, 3));
            break;
        case '4':
            console.log("Shape: Star (Solid)");
            geometry.setAttribute('position', new THREE.BufferAttribute(particles.star, 3));
            break;
    }
    
    geometry.attributes.position.needsUpdate = true;
}

/* =========================================
   ANIMATE LOOP
   ========================================= */
function animate() {
    requestAnimationFrame(animate);
    
    // Gentle rotation
    particlesMesh.rotation.y += 0.002;
    particlesMesh.rotation.x += 0.001;

    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start
init();