// REMOVED: import * as THREE from 'three';
// REMOVED: import * as CANNON from 'cannon-es';
// We now rely on the global THREE and CANNON objects loaded via <script> tags in index.html

// Optional: import CannonDebugger from 'cannon-es-debugger'; // If you use this, it needs to be loaded via <script> too

// --- Global Variables ---
let scene, camera, renderer, clock, cannonWorld, cannonDebugger;
let player = {
    mesh: null,
    body: null,
    controls: {
        throttle: 0, // 0 to 1
        yaw: 0,      // -1 to 1
        pitch: 0,    // -1 to 1 (usually not directly controlled in this setup)
        roll: 0,     // -1 to 1
        keyW: false, keyS: false, keyA: false, keyD: false
    },
    physics: {
        maxThrottleForce: 300, // Max engine thrust
        liftCoefficient: 0.08,  // Controls how much lift is generated
        dragCoefficient: 0.001, // Air resistance
        rollSensitivity: 0.1,
        yawSensitivity: 0.05,
        minStallSpeed: 30,    // Speed below which stall occurs (knots)
        currentSpeed: 0,
        isStalled: false,
        altitude: 0
    }
};
let hudElements = {};
let skybox;
let directionalLight, ambientLight;
let sounds = { engine: null, wind: null, collision: null, music: null }; // Placeholders for Audio objects
let gameMode = 'Free Flight';
let cityObjects = { meshes: [], bodies: [] }; // Store city elements
let aiTraffic = []; // Store AI vehicles {mesh, body, path}
let lastTime = performance.now();
let dayNightCycle = { time: 0.25, speed: 0.005 }; // 0=midnight, 0.25=sunrise, 0.5=midday, 0.75=sunset
let minimap = { element: null, playerMarker: null, scale: 50 }; // Pixels per world unit

const loadingManager = new THREE.LoadingManager(); // THREE is now global
const textureLoader = new THREE.TextureLoader(loadingManager); // THREE is now global
// Add GLTFLoader, AudioLoader etc. if loading external assets

// --- Constants ---
const G = 9.82; // Gravity
const KNOTS_TO_MS = 0.514444; // Conversion factor
const MS_TO_KNOTS = 1 / KNOTS_TO_MS;
const FEET_TO_METERS = 0.3048;
const METERS_TO_FEET = 1 / FEET_TO_METERS;

// --- Initialization ---

function init() {
    setupLoadingScreen();
    initThree();
    initCannon();
    initLighting();
    createSkybox();
    createGround();
    createPlayer();
    createCity(); // Start with simple procedural/static city
    // createAITraffic(); // Implement later
    initControls();
    initHUD();
    initAudio();
    // initCannonDebugger(); // Optional

    loadingManager.onLoad = () => {
        console.log('Loading complete!');
        const loadingScreen = document.getElementById('loading-screen');
        loadingScreen.style.opacity = '0';
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 500); // Fade out
        // document.getElementById('mode-selection').style.display = 'block'; // Show mode buttons if needed
        animate(); // Start the main loop only after loading
    };

     loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
        // Only show progress if there are items being managed
        if (itemsTotal > 0) {
            const progress = Math.round((itemsLoaded / itemsTotal) * 100);
            document.getElementById('loading-progress').textContent = `${progress}%`;
            console.log(`Loading file: ${url} (${itemsLoaded}/${itemsTotal})`);
        } else {
             document.getElementById('loading-progress').textContent = `Initializing...`; // Or keep it at 0%
        }
    };

    loadingManager.onError = (url) => {
        console.error('There was an error loading ' + url);
         document.getElementById('loading-screen').innerHTML = `<div>Error loading asset: ${url}. Please refresh.</div>`; // Show error
    };

    // If not using LoadingManager for assets, call animate() directly after setup
    // animate();

     // Check if the loading manager thinks it's done immediately (no assets registered yet)
    // Give it a tiny moment for potential textureLoader registration, etc.
    setTimeout(() => {
        if (!loadingManager.isLoading) {
             // Ensure progress shows 100% before fading out if no assets were loaded
             document.getElementById('loading-progress').textContent = `100%`;
             loadingManager.onLoad(); // Manually trigger onLoad if nothing is loading
        }
    }, 100); // Small delay
}

function setupLoadingScreen() {
     document.getElementById('loading-progress').textContent = `0%`;
     // Actual progress depends on assets being added to the loadingManager (e.g., via TextureLoader)
}


function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 20000); // Increased far plane
    // Position camera slightly behind and above the starting point
    camera.position.set(0, 15, -25);
    camera.lookAt(0, 5, 0); // Look slightly downwards

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('simulator-canvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; // Enable shadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // renderer.physicallyCorrectLights = true; // Deprecated in newer Three.js versions, use renderer.useLegacyLights = false; if needed, but check compatibility with r128
    renderer.outputEncoding = THREE.sRGBEncoding; // Correct color space


    clock = new THREE.Clock();

    window.addEventListener('resize', onWindowResize, false);
}

function initCannon() {
    cannonWorld = new CANNON.World(); // CANNON is now global
    cannonWorld.gravity.set(0, -G, 0);
    cannonWorld.broadphase = new CANNON.SAPBroadphase(cannonWorld); // Efficient broadphase
    // cannonWorld.solver.iterations = 10; // Adjust solver iterations for stability/performance

    // Collision Material setup
    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(
        defaultMaterial,
        defaultMaterial,
        {
            friction: 0.1, // Low friction for ground/buildings
            restitution: 0.2 // Slight bounce
        }
    );
    cannonWorld.addContactMaterial(defaultContactMaterial);
    cannonWorld.defaultContactMaterial = defaultContactMaterial;
}

// Optional: Cannon Debugger
// function initCannonDebugger() {
//     // Ensure CannonDebugger is loaded via <script> tag if used
//     if (typeof CannonDebugger !== 'undefined') {
//         cannonDebugger = new CannonDebugger(scene, cannonWorld, {
//             color: 0x00ff00, // wireframe color
//         });
//     } else {
//         console.warn("CannonDebugger script not loaded.");
//     }
// }

function initLighting() {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.2); // Low ambient light
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 1); // Main sun/moon light
    directionalLight.position.set(100, 150, 100); // Initial position (adjust with day/night cycle)
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048; // Higher res shadows
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 50;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -200;
    directionalLight.shadow.camera.right = 200;
    directionalLight.shadow.camera.top = 200;
    directionalLight.shadow.camera.bottom = -200;
    scene.add(directionalLight);
    scene.add(directionalLight.target); // Target needs to be in the scene
}

function createSkybox() {
    // Using a simple color background as before
    scene.background = new THREE.Color(0x87CEEB); // Day sky color
    // Placeholder: Could use a large sphere with a gradient texture later
    // Example using CubeTextureLoader (make sure to load images via loadingManager)
    /*
    const loader = new THREE.CubeTextureLoader(loadingManager);
    const texture = loader.load([
        'path/to/px.jpg', 'path/to/nx.jpg',
        'path/to/py.jpg', 'path/to/ny.jpg',
        'path/to/pz.jpg', 'path/to/nz.jpg'
    ]);
    scene.background = texture;
    */
}

function createGround() {
    // Three.js visual ground
    const groundGeometry = new THREE.PlaneGeometry(10000, 10000); // Large ground plane
    // Simple green color, replace with texture (road network, etc.)
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x556B2F, // Dark Olive Green
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide // Render both sides
    });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2; // Rotate flat
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Cannon.js physics ground
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0, material: cannonWorld.defaultContactMaterial }); // Mass 0 makes it static
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); // Rotate flat
    cannonWorld.addBody(groundBody);
}

function createPlayer() {
    // Three.js visual plane (Placeholder: Use a Box)
    // TODO: Replace with loaded low-poly plane model (e.g., GLTF)
    const planeGeometry = new THREE.BoxGeometry(10, 2, 8); // Simplified dimensions
    const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.5, metalness: 0.3 });
    player.mesh = new THREE.Mesh(planeGeometry, planeMaterial);
    player.mesh.castShadow = true;
    player.mesh.position.set(0, 10, 0); // Starting position
    scene.add(player.mesh);

    // Cannon.js physics body
    const planeShape = new CANNON.Box(new CANNON.Vec3(5, 1, 4)); // Half-extents match geometry
    player.body = new CANNON.Body({
        mass: 500, // Aircraft mass in kg
        position: new CANNON.Vec3(0, 10, 0),
        material: cannonWorld.defaultContactMaterial,
        linearDamping: 0.0, // We'll apply custom drag
        angularDamping: 0.5  // Some natural angular damping
    });
    player.body.addShape(planeShape);
    cannonWorld.addBody(player.body);

    // Collision listener for the player
    player.body.addEventListener('collide', (event) => {
        console.log("Collision detected!");
        // Play collision sound only on significant impact
        const impactVelocity = event.contact.getImpactVelocityAlongNormal();
        if (Math.abs(impactVelocity) > 2) { // Threshold for sound
             playSound(sounds.collision);
             // Maybe add damage or reset logic here
             // Simple reset on hard collision:
             // resetSimulation();
        }
    });
}

function createCity() {
    // Simple Procedural/Static City Placeholder
    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8, metalness: 0.1 });
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.0 });
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 }); // Emissive streetlights

    const gridSize = 10;
    const spacing = 150;
    const buildingHeightVariance = 80;
    const buildingBaseSize = 40;

    for (let i = -gridSize / 2; i < gridSize / 2; i++) {
        for (let j = -gridSize / 2; j < gridSize / 2; j++) {
            if (Math.random() > 0.3) { // Chance to place a building
                const height = 20 + Math.random() * buildingHeightVariance;
                const width = buildingBaseSize * (0.8 + Math.random() * 0.4);
                const depth = buildingBaseSize * (0.8 + Math.random() * 0.4);

                const buildingGeom = new THREE.BoxGeometry(width, height, depth);
                const buildingMesh = new THREE.Mesh(buildingGeom, buildingMaterial.clone()); // Clone for potential color variation
                buildingMesh.castShadow = true;
                buildingMesh.receiveShadow = true;

                const x = i * spacing + (Math.random() - 0.5) * spacing * 0.3;
                const z = j * spacing + (Math.random() - 0.5) * spacing * 0.3;
                // Position based on center bottom, ensuring it sits ON the ground (y=0)
                buildingMesh.position.set(x, height / 2, z);
                scene.add(buildingMesh);
                cityObjects.meshes.push(buildingMesh);

                // Physics Body for the building
                const buildingShape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2));
                const buildingBody = new CANNON.Body({ mass: 0 }); // Static
                buildingBody.addShape(buildingShape);
                buildingBody.position.copy(buildingMesh.position); // Use the mesh's calculated position
                buildingBody.material = cannonWorld.defaultContactMaterial;
                cannonWorld.addBody(buildingBody);
                cityObjects.bodies.push(buildingBody);

                // Add simple streetlight?
                 if (Math.random() < 0.2) {
                    const poleHeight = 10;
                    const poleGeom = new THREE.CylinderGeometry(0.5, 0.5, poleHeight, 8);
                    const poleMesh = new THREE.Mesh(poleGeom, roadMaterial);
                    poleMesh.castShadow = true; // Small objects might not need shadows
                    poleMesh.position.set(x + width/2 + 5, poleHeight/2, z);
                    scene.add(poleMesh);

                    const lightGeom = new THREE.SphereGeometry(1, 8, 8);
                    const lightMesh = new THREE.Mesh(lightGeom, lightMaterial);
                    lightMesh.position.set(x + width/2 + 5, poleHeight + 1, z);
                    scene.add(lightMesh);
                    // Store light mesh to turn on/off later
                 }

            } else {
                // Maybe place road segment visual (plane) here?
                 const roadGeom = new THREE.PlaneGeometry(spacing * 0.8, spacing * 0.8);
                 const roadMesh = new THREE.Mesh(roadGeom, roadMaterial);
                 roadMesh.rotation.x = -Math.PI / 2;
                 roadMesh.position.set(i * spacing, 0.05, j* spacing); // Slightly above ground (0.05) to avoid z-fighting
                 roadMesh.receiveShadow = true;
                 scene.add(roadMesh);
                 // No physics body needed for simple flat roads if ground plane exists
            }
        }
    }
    // TODO: Add roads connecting buildings, crosswalk textures, AI paths
    // TODO: Implement proper procedural generation for Endless mode
    // TODO: Implement LOD and Instancing for performance
}


function initControls() {
    // Use named functions for event listeners to allow removal if needed
    const handleKeyDown = (event) => {
        switch (event.code) {
            case 'KeyW': player.controls.keyW = true; break;
            case 'KeyS': player.controls.keyS = true; break;
            case 'KeyA': player.controls.keyA = true; break;
            case 'KeyD': player.controls.keyD = true; break;
            // Add other keys if needed (e.g., pitch, flaps)
        }
    };

    const handleKeyUp = (event) => {
         switch (event.code) {
            case 'KeyW': player.controls.keyW = false; break;
            case 'KeyS': player.controls.keyS = false; break;
            case 'KeyA': player.controls.keyA = false; break;
            case 'KeyD': player.controls.keyD = false; break;
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // --- Touch Controls ---
    const joystickArea = document.getElementById('joystick-area');
    const throttleArea = document.getElementById('throttle-area');
    let joystickTouchId = null;
    let throttleTouchId = null;
    let joystickStartX = 0;
    let joystickStartY = 0; // Might need Y for pitch later

    // Helper to get touch by ID
    const findTouch = (touchList, id) => {
        for (let i = 0; i < touchList.length; i++) {
            if (touchList[i].identifier === id) {
                return touchList[i];
            }
        }
        return null;
    };

    // --- Joystick Listeners ---
     joystickArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (joystickTouchId === null) { // Only track the first touch in this area
            const touch = e.changedTouches[0];
            joystickTouchId = touch.identifier;
            joystickStartX = touch.clientX;
            // joystickStartY = touch.clientY; // Store if using pitch
        }
    }, { passive: false });

     joystickArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (joystickTouchId !== null) {
            const touch = findTouch(e.changedTouches, joystickTouchId);
            if (touch) {
                const deltaX = touch.clientX - joystickStartX;
                // Map deltaX to yaw/roll (-1 to 1) - Adjust sensitivity/range
                const maxDelta = 60; // Pixels for full deflection
                player.controls.yaw = Math.max(-1, Math.min(1, deltaX / maxDelta));
                player.controls.roll = player.controls.yaw; // Simple combined roll/yaw for now
                // Could add pitch control using deltaY similarly
            }
        }
    }, { passive: false });

    const handleJoystickEnd = (e) => {
        if (joystickTouchId !== null) {
            const touch = findTouch(e.changedTouches, joystickTouchId);
            if (touch) { // If the touch ending is the one we were tracking
                joystickTouchId = null;
                player.controls.yaw = 0;
                player.controls.roll = 0;
                // player.controls.pitch = 0; // Reset pitch too if used
            }
        }
    };
    joystickArea.addEventListener('touchend', handleJoystickEnd);
    joystickArea.addEventListener('touchcancel', handleJoystickEnd); // Handle cancellation too


    // --- Throttle Listeners ---
    const updateThrottleFromTouch = (touch) => {
        const rect = throttleArea.getBoundingClientRect();
        const touchY = touch.clientY - rect.top; // Y position within the element
        // Invert Y: top is full throttle (1), bottom is zero throttle (0)
        const throttlePercentage = 1.0 - Math.max(0, Math.min(1, touchY / rect.height));
        player.controls.throttle = throttlePercentage;
    };

     throttleArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
         if (throttleTouchId === null) {
            const touch = e.changedTouches[0];
            throttleTouchId = touch.identifier;
            updateThrottleFromTouch(touch);
         }
    }, { passive: false });

    throttleArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
         if (throttleTouchId !== null) {
             const touch = findTouch(e.changedTouches, throttleTouchId);
             if(touch) {
                 updateThrottleFromTouch(touch);
             }
        }
    }, { passive: false });

     const handleThrottleEnd = (e) => {
         if (throttleTouchId !== null) {
            const touch = findTouch(e.changedTouches, throttleTouchId);
            if(touch) {
                throttleTouchId = null;
                // Decide behavior on release: keep last value or set to 0?
                // player.controls.throttle = 0; // Uncomment to set throttle to 0 on release
            }
        }
     };
     throttleArea.addEventListener('touchend', handleThrottleEnd);
     throttleArea.addEventListener('touchcancel', handleThrottleEnd);
}


function initHUD() {
    hudElements.throttle = document.getElementById('throttle-value');
    hudElements.speed = document.getElementById('speed-value');
    hudElements.altitude = document.getElementById('altitude-value');
    hudElements.compassNeedle = document.getElementById('compass-needle');
    hudElements.stallWarning = document.getElementById('stall-warning');
    hudElements.minimap = document.getElementById('minimap');
    hudElements.minimapPlayer = document.getElementById('minimap-player');
    // Get references to other HUD elements if needed
}

function initAudio() {
    // Use Web Audio API for real implementation
    console.warn("Audio setup is placeholder. Use Web Audio API for better control.");
    // Example conceptual loading (needs real files and loader):
    /*
    const listener = new THREE.AudioListener();
    camera.add(listener); // Attach listener to camera for positional audio
    const audioLoader = new THREE.AudioLoader(loadingManager); // Use the main loading manager

    sounds.engine = new THREE.PositionalAudio(listener);
    audioLoader.load('sounds/engine_loop.ogg', function(buffer) { // Provide actual path
        sounds.engine.setBuffer(buffer);
        sounds.engine.setLoop(true);
        sounds.engine.setVolume(0); // Start silent
        sounds.engine.setRefDistance(10); // Adjust based on scale
        if (player.mesh) player.mesh.add(sounds.engine); // Attach sound to the plane mesh
        // Don't play immediately, wait for throttle/engine start logic?
        // sounds.engine.play();
        console.log("Engine sound loaded");
    }, undefined, function (err) { console.error("Error loading engine sound:", err); });

     // Load wind, collision, music similarly
     sounds.collision = new THREE.Audio(listener); // Non-positional for impact
     audioLoader.load('sounds/collision.wav', function(buffer) { // Provide actual path
         sounds.collision.setBuffer(buffer);
         sounds.collision.setLoop(false);
         sounds.collision.setVolume(0.8); // Set a default volume
         console.log("Collision sound loaded");
     }, undefined, function (err) { console.error("Error loading collision sound:", err); });
     */
}

// --- Update Functions ---

function updatePlayerControls(deltaTime) {
    const throttleRate = 0.5 * deltaTime; // How fast throttle changes per second

    // Keyboard Throttle
    if (player.controls.keyW) {
        player.controls.throttle = Math.min(1.0, player.controls.throttle + throttleRate);
    } else if (player.controls.keyS) {
        player.controls.throttle = Math.max(0.0, player.controls.throttle - throttleRate);
    }
    // Note: Touch throttle updates directly in its event listeners

     // Keyboard Yaw/Roll (combine A/D for arcade feel)
     // Only apply keyboard roll/yaw if touch joystick is not active
    if (joystickTouchId === null) {
        const turnRate = 2.0 * deltaTime; // How fast roll/yaw applies
        if (player.controls.keyA) {
            player.controls.yaw = Math.max(-1, player.controls.yaw - turnRate);
            player.controls.roll = player.controls.yaw; // Link roll to yaw
        } else if (player.controls.keyD) {
            player.controls.yaw = Math.min(1, player.controls.yaw + turnRate);
            player.controls.roll = player.controls.yaw; // Link roll to yaw
        } else {
             // Gently return to center if no keys are pressed
             player.controls.yaw *= (1 - turnRate * 1.5); // Faster centering
             player.controls.roll = player.controls.yaw;
             if (Math.abs(player.controls.yaw) < 0.01) player.controls.yaw = 0; // Snap to zero
        }
    }
    // Touch controls update player.controls.yaw/roll directly in their event listeners
}


function updatePhysics(deltaTime) {
    if (!player.body || !player.mesh) return;

    const body = player.body;
    const controls = player.controls;
    const physics = player.physics;

    // --- Calculate Speed and Altitude ---
    const velocity = body.velocity;
    // Correct calculation of speed relative to the ground plane (horizontal speed) might be more relevant for stall
    // const horizontalVelocity = new CANNON.Vec3(velocity.x, 0, velocity.z);
    // physics.currentSpeed = horizontalVelocity.length(); // Consider if vertical speed should affect lift/drag significantly
    physics.currentSpeed = velocity.length(); // Using total speed for now
    physics.altitude = body.position.y * METERS_TO_FEET; // Convert meters to feet

    // --- Stall Condition ---
    const speedKnots = physics.currentSpeed * MS_TO_KNOTS;
    // Stall only if significantly above ground (e.g., > 3 meters / ~10 feet)
    physics.isStalled = speedKnots < physics.minStallSpeed && body.position.y > 3;

    // --- Get Body Orientation Vectors ---
    // These vectors represent the direction the plane's axes point in world space
    const forwardVector = new CANNON.Vec3();
    body.quaternion.vmult(new CANNON.Vec3(0, 0, 1), forwardVector); // Local Z+ is forward

    const upVector = new CANNON.Vec3();
    body.quaternion.vmult(new CANNON.Vec3(0, 1, 0), upVector); // Local Y+ is up

    const rightVector = new CANNON.Vec3();
    body.quaternion.vmult(new CANNON.Vec3(1, 0, 0), rightVector); // Local X+ is right

    // --- Forces ---

    // 1. Thrust (Acts along the plane's forward direction)
    const thrustForceMagnitude = controls.throttle * physics.maxThrottleForce;
    const thrustForce = forwardVector.scale(thrustForceMagnitude);
    body.applyForce(thrustForce, body.position); // Apply at center of mass for simplicity

    // 2. Lift (Acts perpendicular to velocity and the plane's wings - simplified to act along the plane's up vector)
    // Lift depends on speed squared and angle of attack (simplified here)
    let liftMagnitude = physics.liftCoefficient * physics.currentSpeed * physics.currentSpeed;
    if (physics.isStalled) {
        liftMagnitude *= 0.15; // Drastically reduce lift when stalled
        // Optional: Add slight random instability torque when stalled
    }
    // Lift should generally oppose gravity but act along the plane's 'up'
    const liftForce = upVector.scale(Math.max(0, liftMagnitude)); // No negative lift
    // Apply lift slightly behind center of mass? (e.g., body.position - forwardVector * 0.5) For now, center.
    body.applyForce(liftForce, body.position);

    // 3. Drag (Opposes the direction of velocity)
    const dragMagnitude = physics.dragCoefficient * physics.currentSpeed * physics.currentSpeed;
    const dragForce = velocity.scale(-dragMagnitude); // Directly opposes world velocity vector
    // Ensure drag doesn't completely stop the plane instantly at low speed if needed
    // dragForce.scale(Math.min(1, physics.currentSpeed / 0.1)); // Reduce effect at very low speeds?
    body.applyForce(dragForce, body.position);

    // 4. Gravity (applied by Cannon.js world automatically: body.force += gravity * mass)

    // --- Torques (Rotational Forces applied in LOCAL space) ---
    const torque = new CANNON.Vec3();
    const torqueFactor = 50; // General scaling factor for torques, adjust as needed

    // Roll (Rotation around the local Z / forward axis) based on controls.roll
    torque.z += -controls.roll * physics.rollSensitivity * torqueFactor * Math.max(0.5, physics.currentSpeed / 10); // Roll more effective at higher speed (with a base effectiveness)

    // Yaw (Rotation around the local Y / up axis) based on controls.yaw
    torque.y += -controls.yaw * physics.yawSensitivity * torqueFactor * Math.max(0.5, physics.currentSpeed / 10); // Yaw more effective at higher speed

    // Pitch (Rotation around the local X / right axis) - Currently not directly controlled
    // Gentle pitch down when stalled to aid recovery
    if (physics.isStalled) {
         torque.x += 0.1 * torqueFactor; // Nudge nose down when stalled
    }
    // Simple Pitch control placeholder (e.g., link to up/down arrows or touch Y)
    // torque.x += controls.pitch * physics.pitchSensitivity * torqueFactor * Math.max(0.5, physics.currentSpeed / 10);


    // Apply Angular Damping (simulates air resistance to rotation)
    // Cannon's built-in angularDamping is applied globally.
    // We can add custom damping proportional to angular velocity squared for more effect at high spin rates if needed.
    // const angVel = body.angularVelocity;
    // body.torque.x -= angVel.x * Math.abs(angVel.x) * dampingFactor; // Example non-linear damping
    // body.torque.y -= angVel.y * Math.abs(angVel.y) * dampingFactor;
    // body.torque.z -= angVel.z * Math.abs(angVel.z) * dampingFactor;

    body.applyLocalTorque(torque); // Apply the calculated torque in the object's local coordinate system
}

function updateCamera() {
    if (!player.mesh) return;

    // Simple third-person follow camera
    const baseOffset = new THREE.Vector3(0, 5, -15); // Base offset behind and slightly above
    const targetOffset = baseOffset.clone().applyQuaternion(player.mesh.quaternion); // Rotate offset by plane's rotation
    targetOffset.add(player.mesh.position); // Add plane's world position

    // Smoothly interpolate camera position (Lerp)
    const lerpFactor = 0.08; // Lower value = smoother/slower follow
    camera.position.lerp(targetOffset, lerpFactor);
    // camera.position.copy(targetOffset); // Snappy camera (for debugging)

    // Look at a point slightly in front of and above the plane's center
    const lookAtBase = new THREE.Vector3(0, 1, 5); // Point in front of plane (local space)
    const lookAtTarget = lookAtBase.clone().applyQuaternion(player.mesh.quaternion);
    lookAtTarget.add(player.mesh.position);

    // Smoothly interpolate lookAt target? Optional, often lookAt is kept direct.
    camera.lookAt(lookAtTarget);
    // camera.lookAt(player.mesh.position); // Simpler lookAt plane center
}

function updateHUD() {
    if (!hudElements.throttle) return; // Check if HUD is initialized

    hudElements.throttle.textContent = (player.controls.throttle * 100).toFixed(0);
    hudElements.speed.textContent = (player.physics.currentSpeed * MS_TO_KNOTS).toFixed(0);
    hudElements.altitude.textContent = Math.max(0, player.physics.altitude).toFixed(0); // Altitude in feet, non-negative

    // Compass
    if (player.mesh) {
        // Get the forward direction in the world XY plane (top-down view)
        const forward = new THREE.Vector3(0, 0, 1);
        forward.applyQuaternion(player.mesh.quaternion);
        forward.y = 0; // Project onto the horizontal plane
        forward.normalize();

        // Calculate angle from North (positive Z axis)
        // atan2(x, z) gives angle from +Z axis in range -PI to PI
        const angleRad = Math.atan2(forward.x, forward.z);

        // Update compass needle rotation in CSS (expects degrees or radians)
        hudElements.compassNeedle.style.transform = `rotate(${-angleRad}rad)`; // CSS rotation is clockwise positive

        // Optional: Update the text (N, E, S, W) - more complex
         const angleDeg = angleRad * (180 / Math.PI);
         let direction = "N";
         if (angleDeg > -22.5 && angleDeg <= 22.5) direction = "N";
         else if (angleDeg > 22.5 && angleDeg <= 67.5) direction = "NE";
         else if (angleDeg > 67.5 && angleDeg <= 112.5) direction = "E";
         else if (angleDeg > 112.5 && angleDeg <= 157.5) direction = "SE";
         else if (angleDeg > 157.5 || angleDeg <= -157.5) direction = "S";
         else if (angleDeg > -157.5 && angleDeg <= -112.5) direction = "SW";
         else if (angleDeg > -112.5 && angleDeg <= -67.5) direction = "W";
         else if (angleDeg > -67.5 && angleDeg <= -22.5) direction = "NW";
         // hudElements.compassNeedle.textContent = direction; // Update text if needed
    }

    // Stall Warning
    hudElements.stallWarning.style.display = player.physics.isStalled ? 'block' : 'none';

    // Minimap Player Position (Simple top-down)
     if (player.mesh && hudElements.minimapPlayer && hudElements.minimap) {
        const mapWidth = hudElements.minimap.offsetWidth;
        const mapHeight = hudElements.minimap.offsetHeight;
        const mapCenterX = mapWidth / 2;
        const mapCenterY = mapHeight / 2;

        // Calculate position relative to map center (0,0 in world = map center)
        // Inverted Z for map Y (world +Z is often 'up' on maps)
        const mapX = player.mesh.position.x / minimap.scale;
        const mapY = -player.mesh.position.z / minimap.scale; // Use -Z for the vertical axis on the map

        // Keep player marker centered, move the map background instead? (More complex)
        // For now, move the marker within the fixed map view:
        const markerX = mapCenterX + mapX;
        const markerY = mapCenterY + mapY;

        // Clamp marker position to stay within map bounds (optional)
        // const clampedX = Math.max(2, Math.min(mapWidth - 2, markerX));
        // const clampedY = Math.max(2, Math.min(mapHeight - 2, markerY));

        hudElements.minimapPlayer.style.left = `${markerX}px`;
        hudElements.minimapPlayer.style.top = `${markerY}px`;

        // Rotate player marker based on horizontal orientation
         const forward = new THREE.Vector3(0, 0, 1);
         forward.applyQuaternion(player.mesh.quaternion);
         const mapAngleRad = Math.atan2(forward.x, forward.z); // Angle from +Z (North)
         // CSS rotate uses clockwise positive, no negation needed if atan2(x,z) used
         hudElements.minimapPlayer.style.transform = `translate(-50%, -50%) rotate(${mapAngleRad}rad)`;
    }
    // TODO: Draw minimap markers for buildings, AI, checkpoints relative to player or map center
}

function updateDayNightCycle(deltaTime) {
    dayNightCycle.time = (dayNightCycle.time + deltaTime * dayNightCycle.speed) % 1.0; // Cycle between 0 and 1

    // Calculate sun position (simple circular path over X-Y plane)
    const angle = dayNightCycle.time * Math.PI * 2;
    const sunDistance = 300; // How far the sun orbits
    const maxHeight = 200; // Max height at midday
    directionalLight.position.set(
        0, // Keep sun centered horizontally for simplicity? Or use Math.cos(angle - Math.PI/2) * sunDistance,
        Math.sin(angle) * maxHeight,        // Y position (sun height, 0 at sunrise/sunset, maxHeight at noon)
        Math.cos(angle) * sunDistance        // Z position (moves from horizon to horizon)
    );
     directionalLight.target.position.set(0, 0, 0); // Keep light pointing at the origin

    // Adjust light intensity and color based on sun height (Y position)
    const sunHeight = directionalLight.position.y;
    let intensity = 0;
    let skyColor = new THREE.Color(0x000010); // Night sky
    let ambientIntensity = 0.05; // Minimum ambient (moonlight)

    const horizonY = -30; // Y value below which it's fully night
    const fullDayY = 50;  // Y value above which it's full day intensity/color

    if (sunHeight > horizonY) { // Sun is up or near horizon
         // Calculate transition factor (0 at horizonY, 1 at fullDayY)
        const transition = Math.min(1, Math.max(0, (sunHeight - horizonY) / (fullDayY - horizonY)));

        // Intensity (Increase from 0 to max intensity)
        intensity = transition * 1.2; // Max intensity during the day

        // Ambient Light (Increase from moonlight to brighter day ambient)
        ambientIntensity = 0.05 + transition * 0.35; // Max 0.4 ambient

        // Color interpolation
        const daySunColor = new THREE.Color(0xffffff);
        const dawnDuskSunColor = new THREE.Color(0xffaa66); // Orange hue
        const daySkyColor = new THREE.Color(0x87CEEB); // Day sky blue
        const dawnDuskSkyColor = new THREE.Color(0xFFD7A1); // Light orange horizon sky
        const nightSkyColor = new THREE.Color(0x000010); // Deep blue/black

        // Interpolate sun color (Orange near horizon, white higher up)
        directionalLight.color.lerpColors(dawnDuskSunColor, daySunColor, Math.min(1, Math.max(0, sunHeight / fullDayY)));

        // Interpolate sky color (More complex: from night->dawn->day->dusk->night)
         if (sunHeight > fullDayY * 0.5) { // Upper part of day
            skyColor.lerpColors(dawnDuskSkyColor, daySkyColor, Math.min(1, Math.max(0, (sunHeight - fullDayY*0.5) / (maxHeight - fullDayY*0.5))));
         } else if (sunHeight > horizonY) { // Rising / Setting phase
             skyColor.lerpColors(nightSkyColor, dawnDuskSkyColor, transition);
         }

    } // else: Night time values remain (intensity=0, ambient=0.05, sky=nightSkyColor)


    directionalLight.intensity = intensity;
    ambientLight.intensity = ambientIntensity;
    if (scene.background instanceof THREE.Color) { // Only update if background is a color
        scene.background.copy(skyColor);
    } else {
        // Handle skybox texture fading/switching here if using a texture
    }

    // TODO: Update skybox texture based on time
    // TODO: Turn streetlights (emissive materials) on/off based on time
    // Find lights and toggle emissive intensity based on `intensity` or `dayNightCycle.time`
}


function updateAudio() {
    // Placeholder for updating sounds based on game state
    if (sounds.engine /* && sounds.engine.isPlaying */) { // Check if sound exists (and optionally if playing)
        // Adjust engine volume based on throttle
        const baseVolume = 0.05; // Lower base volume
        const throttleVolume = player.controls.throttle * 0.5; // Max volume contribution from throttle
        // sounds.engine.setVolume(baseVolume + throttleVolume);

        // Adjust playback rate (pitch) based on throttle/speed (requires experimentation)
        // const basePlaybackRate = 0.7;
        // const throttleFactor = 1.0 + player.controls.throttle * 0.8; // Pitch increases with throttle
        // sounds.engine.setPlaybackRate(basePlaybackRate * throttleFactor);

        // Example: Play engine sound if throttle > 0 and not playing, stop if throttle == 0
        // if (player.controls.throttle > 0 && !sounds.engine.isPlaying) {
        //     sounds.engine.play();
        // } else if (player.controls.throttle === 0 && sounds.engine.isPlaying) {
        //     sounds.engine.stop();
        // }
    }

     if (sounds.wind /* && sounds.wind.isPlaying */) {
        // Adjust wind volume based on speed (e.g., logarithmic or clamped linear)
        // const windVolume = Math.min(1.0, (player.physics.currentSpeed * MS_TO_KNOTS) / 150); // Volume scales up to 150 knots
        // sounds.wind.setVolume(windVolume);
        // Similar play/stop logic based on speed threshold could be used
    }
}

function playSound(sound) {
    // Placeholder for playing non-looping sounds like collisions
    if (sound /* && sound.isLoaded */) { // Check if sound exists and is loaded
        // if (sound.isPlaying) {
        //     sound.stop(); // Stop previous play if still going (optional, depends on sound type)
        // }
        // sound.play(); // Play the sound
        console.log("Placeholder: Play sound effect (e.g., collision)");
    }
}


function syncMeshesWithBodies() {
    // Sync player
    if (player.mesh && player.body) {
        player.mesh.position.copy(player.body.position);
        player.mesh.quaternion.copy(player.body.quaternion);
    }

    // Sync city objects (Only needed if they were dynamic, but good practice if physics might change them)
    // Currently static, so no sync needed. If buildings could be destroyed/moved:
    /*
    for (let i = 0; i < cityObjects.meshes.length; i++) {
         if (cityObjects.meshes[i] && cityObjects.bodies[i]) { // Check existence
            cityObjects.meshes[i].position.copy(cityObjects.bodies[i].position);
            cityObjects.meshes[i].quaternion.copy(cityObjects.bodies[i].quaternion);
         }
    }
    */

    // Sync AI Traffic (if implemented)
    /*
    for (const vehicle of aiTraffic) {
        if (vehicle.mesh && vehicle.body) {
            vehicle.mesh.position.copy(vehicle.body.position);
            vehicle.mesh.quaternion.copy(vehicle.body.quaternion);
        }
    }
    */
}

// --- Game Loop ---

function animate() {
    // Request the next frame
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    // Calculate deltaTime, ensure it's not too large (e.g., when tab loses focus)
    const rawDeltaTime = (currentTime - lastTime) / 1000; // Delta time in seconds
    const deltaTime = Math.min(rawDeltaTime, 1 / 20); // Clamp delta time to max 50ms (1/20 = 0.05)
    lastTime = currentTime;

    // --- Simulation Steps ---

    // 1. Update Controls Input State (polls keys, updates internal state)
    updatePlayerControls(deltaTime);

    // 2. Update Game Logic (Day/Night, AI, Checkpoints, etc.)
    updateDayNightCycle(deltaTime);
    // updateAI(deltaTime); // TODO
    // checkGameRules(); // TODO (e.g., checkpoints, objectives)
    // manageProceduralGeneration(); // TODO

    // 3. Apply Physics Forces/Torques (based on controls and environment)
    // This should happen *before* stepping the physics world
    updatePhysics(deltaTime);

    // 4. Step the Physics World
    // Use a fixed timestep for stability, with variable sub-steps based on deltaTime
    const fixedTimeStep = 1 / 60; // Target 60 physics updates per second
    const maxSubSteps = 5; // Max substeps to prevent spiral of death if lagging
    cannonWorld.step(fixedTimeStep, deltaTime, maxSubSteps);

    // 5. Sync Graphics with Physics (update mesh positions/rotations)
    syncMeshesWithBodies();

    // 6. Update Camera & Audio Listener Position
    updateCamera();
    updateAudio(); // Update sound properties (volume, pitch)

    // 7. Update HUD
    updateHUD();

    // 8. Render Scene
    // cannonDebugger?.update(); // Update debugger visualization if active AND loaded
    renderer.render(scene, camera);
}

// --- Event Listeners ---

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Adjust HUD/Minimap layout if needed based on new size
}

// --- Game Mode Logic (Basic) ---
function setGameMode(mode) {
    console.log("Setting game mode to:", mode);
    gameMode = mode;
    const modeSelectionDiv = document.getElementById('mode-selection');
    if (modeSelectionDiv) modeSelectionDiv.style.display = 'none';

    resetSimulation(); // Reset positions, scores etc.

    if (mode === 'Endless') {
        // TODO: Activate procedural generation logic for terrain/city
        console.warn("Endless mode requires procedural generation implementation.");
    } else if (mode === 'Checkpoint') {
        // TODO: Create/show checkpoint markers, initialize scoring
        console.warn("Checkpoint mode requires checkpoint logic and assets.");
    }
    // Free flight needs no special setup beyond the default city/reset
}

function resetSimulation() {
    console.log("Resetting simulation...");
    // Reset player position, velocity, orientation, controls
    if (player.body) {
        player.body.position.set(0, 10, 0); // Reset start position
        player.body.velocity.set(0, 0, 0);
        player.body.angularVelocity.set(0, 0, 0);
        player.body.quaternion.set(0, 0, 0, 1); // Reset orientation (identity quaternion)
    }
    if(player.mesh) {
         // Also reset mesh immediately to avoid visual glitch before next sync
        player.mesh.position.copy(player.body.position);
        player.mesh.quaternion.copy(player.body.quaternion);
    }
    player.controls.throttle = 0;
    player.controls.yaw = 0;
    player.controls.roll = 0;
    player.controls.pitch = 0; // Reset pitch if used
    player.controls.keyW = false;
    player.controls.keyS = false;
    player.controls.keyA = false;
    player.controls.keyD = false;
    player.physics.isStalled = false;
    player.physics.currentSpeed = 0;

    // Reset camera target instantly to avoid laggy lookAt
    updateCamera();
    camera.lookAt(player.mesh ? player.mesh.position : new THREE.Vector3(0,5,0));


    // TODO: Reset AI positions and paths
    // TODO: Reset checkpoints (remove existing, create new set for Checkpoint mode)
    // TODO: Reset score, timers etc.

    // Ensure HUD reflects reset state immediately
    updateHUD();
}


// --- Start Simulation ---
// Ensure the DOM is ready before initializing, although placing script at end of body usually suffices
if (document.readyState === 'loading') { // Check if DOM is still loading
    document.addEventListener('DOMContentLoaded', init);
} else { // DOM is already ready
    init();
}