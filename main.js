import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* =========================================
   GLOBAL VARIABLES
   We keep these accessible so different functions can use them.
   ========================================= */
let scene, camera, renderer, controls;
let particlesMesh; // This will hold our cloud of points

// Configuration Settings
const PARTICLE_COUNT = 20000;
const PARTICLE_SIZE = 0.5;

/* =========================================
   INIT: THE SETUP
   This runs once when the page loads.
   ========================================= */
function init() {
    // 1. Create the Scene (The container for all 3D objects)
    scene = new THREE.Scene();
    // Add some soft fog to fade distant particles (aesthetic touch)
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    // 2. Create the Camera (The Eye)
    // PerspectiveCamera(FieldOfView, AspectRatio, NearClip, FarClip)
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 200; // Move camera back so we can see the center

    // 3. Create the Renderer ( The Painter)
    // This takes the scene and draws it onto the <canvas>
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio); // Sharpness on high-res screens
    
    // Attach the renderer's canvas to our HTML div
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 4. Add Controls (Mouse interaction)
    // Allows you to rotate and zoom with the mouse
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Adds a smooth "weight" to the movement

    // 5. Create the Particles
    createParticles();

    // 6. Handle Window Resizing
    // If the user stretches the window, we need to adjust the camera
    window.addEventListener('resize', onWindowResize);

    // 7. Start the Animation Loop
    animate();
}

/* =========================================
   CREATE PARTICLES
   Generates 20,000 points at random positions
   ========================================= */
function createParticles() {
    // A. Geometry: Holds the data (positions)
    const geometry = new THREE.BufferGeometry();

    // We need 3 coordinates (x, y, z) for every single particle
    // Float32Array is a typed array optimized for WebGL
    const positions = new Float32Array(PARTICLE_COUNT * 3);

    // Loop 20,000 times to set random starting positions
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3; // Index for the array (0, 3, 6, 9...)
        
        // Random position between -100 and +100
        positions[i3] = (Math.random() - 0.5) * 500;     // x
        positions[i3 + 1] = (Math.random() - 0.5) * 500; // y
        positions[i3 + 2] = (Math.random() - 0.5) * 500; // z
    }

    // Tell Three.js that this data represents 'position'
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // B. Material: Holds the look (color, size, glowing)
    const material = new THREE.PointsMaterial({
        color: 0xffffff,        // White
        size: PARTICLE_SIZE,    // Size of each dot
        transparent: true,      // Allow transparency
        opacity: 0.8,           // Slightly see-through
        blending: THREE.AdditiveBlending, // Makes overlapping particles glow brighter
        depthWrite: false       // Prevents weird sorting glitches with transparent particles
    });

    // C. Mesh: Combines Geometry + Material
    particlesMesh = new THREE.Points(geometry, material);
    
    // Add it to the scene
    scene.add(particlesMesh);
}

/* =========================================
   ANIMATE LOOP
   Runs 60 times per second to update the screen
   ========================================= */
function animate() {
    requestAnimationFrame(animate); // Recursively call this function

    // Optional: Slowly rotate the whole cloud for effect
    particlesMesh.rotation.y += 0.001; 

    controls.update(); // Update mouse controls damping
    renderer.render(scene, camera); // Draw the frame
}

/* =========================================
   RESIZE HELPER
   ========================================= */
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Kickstart the app!
init();