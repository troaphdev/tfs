import * as THREE from 'three';
import * as CANNON from 'cannon-es';
// Optional: import CannonDebugger from 'cannon-es-debugger'; // If you installed it

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

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
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
        const progress = Math.round((itemsLoaded / itemsTotal) * 100);
        document.getElementById('loading-progress').textContent = `${progress}%`;
        console.log(`Loading file: ${url} (${itemsLoaded}/${itemsTotal})`);
    };

    loadingManager.onError = (url) => {
        console.error('There was an error loading ' + url);
    };

    // If not using LoadingManager for assets, call animate() directly after setup
    // animate();
}

function setupLoadingScreen() {
     document.getElementById('loading-progress').textContent = `0%`;
     // You'll need actual assets hooked to the loadingManager for progress
     // For now, we simulate a load complete almost instantly if no assets are managed
     if(loadingManager.itemsTotal === 0) {
        setTimeout(() => loadingManager.onLoad(), 100); // Simulate tiny delay
     }
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
    renderer.physicallyCorrectLights = true; // Use physically correct light intensity

    clock = new THREE.Clock();

    window.addEventListener('resize', onWindowResize, false);
}

function initCannon() {
    cannonWorld = new CANNON.World();
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
//     cannonDebugger = new CannonDebugger(scene, cannonWorld, {
//         // options...
//          color: 0x00ff00, // wireframe color
//     });
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
    // In production, use CubeTextureLoader with 6 images
    // For now, a simple colored background
    scene.background = new THREE.Color(0x87CEEB); // Day sky color
    // Placeholder: Could use a large sphere with a gradient texture later
}

function createGround() {
    // Three.js visual ground
    const groundGeometry = new THREE.PlaneGeometry(10000, 10000); // Large ground plane
    // Simple green color, replace with texture (road network, etc.)
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x556B2F, // Dark Olive Green
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide
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
                buildingMesh.position.set(x, height / 2, z); // Position based on center bottom
                scene.add(buildingMesh);
                cityObjects.meshes.push(buildingMesh);

                // Physics Body for the building
                const buildingShape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2));
                const buildingBody = new CANNON.Body({ mass: 0 }); // Static
                buildingBody.addShape(buildingShape);
                buildingBody.position.copy(buildingMesh.position);
                buildingBody.material = cannonWorld.defaultContactMaterial;
                cannonWorld.addBody(buildingBody);
                cityObjects.bodies.push(buildingBody);

                // Add simple streetlight?
                 if (Math.random() < 0.2) {
                    const poleHeight = 10;
                    const poleGeom = new THREE.CylinderGeometry(0.5, 0.5, poleHeight, 8);
                    const poleMesh = new THREE.Mesh(poleGeom, roadMaterial);
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
                 roadMesh.position.set(i * spacing, 0.1, j* spacing); // Slightly above ground
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
    window.addEventListener('keydown', (event) => {
        switch (event.code) {
            case 'KeyW': player.controls.keyW = true; break;
            case 'KeyS': player.controls.keyS = true; break;
            case 'KeyA': player.controls.keyA = true; break;
            case 'KeyD': player.controls.keyD = true; break;
        }
    });

    window.addEventListener('keyup', (event) => {
         switch (event.code) {
            case 'KeyW': player.controls.keyW = false; break;
            case 'KeyS': player.controls.keyS = false; break;
            case 'KeyA': player.controls.keyA = false; break;
            case 'KeyD': player.controls.keyD = false; break;
        }
    });

    // Basic Touch Controls (Conceptual)
    const joystickArea = document.getElementById('joystick-area');
    const throttleArea = document.getElementById('throttle-area');
    let touchStartX = 0, touchStartY = 0;
    let throttleTouchY = 0;
    let currentTouchId = null;
    let throttleTouchId = null;

    joystickArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (currentTouchId === null) {
            currentTouchId = e.changedTouches[0].identifier;
            touchStartX = e.changedTouches[0].clientX;
        }
    }, { passive: false });

     joystickArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === currentTouchId) {
                const touchX = e.changedTouches[i].clientX;
                const deltaX = touchX - touchStartX;
                // Map deltaX to yaw/roll (-1 to 1) - Adjust sensitivity
                player.controls.yaw = Math.max(-1, Math.min(1, deltaX / 50));
                player.controls.roll = player.controls.yaw; // Simple combined roll/yaw
                break;
            }
        }
    }, { passive: false });

    joystickArea.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === currentTouchId) {
                currentTouchId = null;
                player.controls.yaw = 0;
                player.controls.roll = 0;
                break;
            }
        }
    });

     throttleArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
         if (throttleTouchId === null) {
            throttleTouchId = e.changedTouches[0].identifier;
             updateThrottleFromTouch(e.changedTouches[0]);
         }
    }, { passive: false });

    throttleArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
         for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === throttleTouchId) {
                 updateThrottleFromTouch(e.changedTouches[i]);
                break;
            }
        }
    }, { passive: false });

     throttleArea.addEventListener('touchend', (e) => {
         for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === throttleTouchId) {
                throttleTouchId = null;
                // Optionally set throttle to 0 or keep last value
                break;
            }
        }
     });

    function updateThrottleFromTouch(touch) {
        const rect = throttleArea.getBoundingClientRect();
        const touchY = touch.clientY - rect.top; // Y position within the element
        const throttlePercentage = 1.0 - Math.max(0, Math.min(1, touchY / rect.height));
        player.controls.throttle = throttlePercentage;
    }
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
    console.warn("Audio setup is placeholder. Use Web Audio API.");
    // Example conceptual loading (needs real files and loader):
    // const listener = new THREE.AudioListener();
    // camera.add(listener); // Attach listener to camera for positional audio
    // const audioLoader = new THREE.AudioLoader(loadingManager);

    // sounds.engine = new THREE.PositionalAudio(listener);
    // audioLoader.load('sounds/engine_loop.ogg', function(buffer) {
    //     sounds.engine.setBuffer(buffer);
    //     sounds.engine.setLoop(true);
    //     sounds.engine.setVolume(0); // Start silent
    //     sounds.engine.setRefDistance(10); // Adjust based on scale
    //     player.mesh.add(sounds.engine); // Attach sound to the plane mesh
    //     sounds.engine.play();
    // });
     // Load wind, collision, music similarly
     // sounds.collision = new THREE.Audio(listener); // Non-positional for impact
}

// --- Update Functions ---

function updatePlayerControls(deltaTime) {
    const throttleRate = 0.5 * deltaTime; // How fast throttle changes

    // Keyboard Throttle
    if (player.controls.keyW) {
        player.controls.throttle = Math.min(1.0, player.controls.throttle + throttleRate);
    } else if (player.controls.keyS) {
        player.controls.throttle = Math.max(0.0, player.controls.throttle - throttleRate);
    }

     // Keyboard Yaw/Roll (combine A/D for arcade feel)
    if (player.controls.keyA) {
        player.controls.yaw = -1;
        player.controls.roll = -1;
    } else if (player.controls.keyD) {
        player.controls.yaw = 1;
        player.controls.roll = 1;
    } else if(currentTouchId === null) { // Don't reset if touch is active
        player.controls.yaw = 0;
        player.controls.roll = 0;
    }
     // Touch controls update player.controls.yaw/roll/throttle directly
}


function updatePhysics(deltaTime) {
    if (!player.body || !player.mesh) return;

    const body = player.body;
    const controls = player.controls;
    const physics = player.physics;

    // --- Calculate Speed and Altitude ---
    const velocity = body.velocity;
    const worldVelocity = new CANNON.Vec3(velocity.x, velocity.y, velocity.z);
    physics.currentSpeed = worldVelocity.length();
    physics.altitude = body.position.y * METERS_TO_FEET; // Convert meters to feet

    // --- Stall Condition ---
    const speedKnots = physics.currentSpeed * MS_TO_KNOTS;
    physics.isStalled = speedKnots < physics.minStallSpeed && physics.altitude > 1 * METERS_TO_FEET ; // Don't stall on ground

    // --- Forces ---
    const forwardVector = new CANNON.Vec3(0, 0, 1); // Local Z is forward
    body.quaternion.vmult(forwardVector, forwardVector); // Rotate to world space

    const upVector = new CANNON.Vec3(0, 1, 0); // Local Y is up
    body.quaternion.vmult(upVector, upVector);

    const rightVector = new CANNON.Vec3(1, 0, 0); // Local X is right
     body.quaternion.vmult(rightVector, rightVector);

    // 1. Thrust
    const thrustForce = forwardVector.scale(controls.throttle * physics.maxThrottleForce);
    body.applyForce(thrustForce, body.position); // Apply at center of mass for simplicity

    // 2. Lift
    let liftMagnitude = physics.liftCoefficient * physics.currentSpeed * physics.currentSpeed; // Simplified lift = C * V^2
    if (physics.isStalled) {
        liftMagnitude *= 0.2; // Drastically reduce lift when stalled
        // Add extra downward force or instability if desired
    }
    // Ensure lift is generally upwards, opposing gravity slightly even at low speeds (simplification)
     const liftForce = upVector.scale(Math.max(0, liftMagnitude)); // No negative lift in this simple model
     // Apply lift slightly behind center of mass maybe? For now, apply at center.
     body.applyForce(liftForce, body.position);


    // 3. Drag
    const dragMagnitude = physics.dragCoefficient * physics.currentSpeed * physics.currentSpeed;
    const dragForce = worldVelocity.scale(-dragMagnitude); // Opposes velocity vector
    body.applyForce(dragForce, body.position);

    // 4. Gravity (applied by Cannon.js world)

    // --- Torques (Rotational Forces) ---
    const torque = new CANNON.Vec3();

    // Roll (around local Z axis) based on A/D or joystick
    torque.z += -controls.roll * physics.rollSensitivity * physics.currentSpeed; // Roll more effective at speed

    // Yaw (around local Y axis) based on A/D or joystick
    torque.y += -controls.yaw * physics.yawSensitivity * physics.currentSpeed; // Yaw more effective at speed

    // Pitch (around local X axis) - Apply a gentle pitch down when stalled
    if (physics.isStalled) {
         torque.x += 0.05; // Nudge nose down when stalled
    }

    // Apply damping proportional to angular velocity to prevent infinite spin
    const angularVelocity = body.angularVelocity;
    torque.x -= angularVelocity.x * 0.8; // Adjust damping factor
    torque.y -= angularVelocity.y * 0.8;
    torque.z -= angularVelocity.z * 0.8;

    body.applyLocalTorque(torque); // Apply torque in the object's local frame
}

function updateCamera() {
    if (!player.mesh) return;

    // Simple third-person follow camera
    const offset = new THREE.Vector3(0, 5, -15); // Behind and slightly above
    offset.applyQuaternion(player.mesh.quaternion); // Rotate offset by plane's rotation
    offset.add(player.mesh.position); // Add plane's position

    camera.position.lerp(offset, 0.1); // Smoothly move camera
    // camera.position.copy(offset); // Snappy camera

    // Look at a point slightly in front of the plane
    const lookAtPoint = new THREE.Vector3(0, 2, 10); // Point in front of plane (local space)
    lookAtPoint.applyQuaternion(player.mesh.quaternion);
    lookAtPoint.add(player.mesh.position);

    camera.lookAt(lookAtPoint);
     // camera.lookAt(player.mesh.position); // Simpler lookAt
}

function updateHUD() {
    hudElements.throttle.textContent = (player.controls.throttle * 100).toFixed(0);
    hudElements.speed.textContent = (player.physics.currentSpeed * MS_TO_KNOTS).toFixed(0);
    hudElements.altitude.textContent = Math.max(0, player.physics.altitude).toFixed(0); // Altitude in feet, non-negative

    // Compass
    if (player.mesh) {
        const forward = new THREE.Vector3(0, 0, 1);
        forward.applyQuaternion(player.mesh.quaternion);
        const angle = Math.atan2(forward.x, forward.z); // Angle from North (positive Z)
        hudElements.compassNeedle.style.transform = `rotate(${-angle}rad)`; // CSS rotation is clockwise
    }

    // Stall Warning
    hudElements.stallWarning.style.display = player.physics.isStalled ? 'block' : 'none';

    // Minimap Player Position (Simple top-down)
     if (player.mesh && hudElements.minimapPlayer) {
        const mapCenterX = hudElements.minimap.offsetWidth / 2;
        const mapCenterY = hudElements.minimap.offsetHeight / 2;
        // Calculate position relative to map center (0,0)
        const mapX = player.mesh.position.x / minimap.scale;
        const mapY = player.mesh.position.z / minimap.scale; // Use Z for the vertical axis on the map

        hudElements.minimapPlayer.style.left = `${mapCenterX + mapX}px`;
        hudElements.minimapPlayer.style.top = `${mapCenterY + mapY}px`;

        // Optional: Rotate player marker
         const forward = new THREE.Vector3(0, 0, 1);
         forward.applyQuaternion(player.mesh.quaternion);
         const mapAngle = Math.atan2(forward.x, forward.z);
         hudElements.minimapPlayer.style.transform = `translate(-50%, -50%) rotate(${mapAngle}rad)`;
    }
    // TODO: Draw minimap markers for buildings, AI, checkpoints
}

function updateDayNightCycle(deltaTime) {
    dayNightCycle.time = (dayNightCycle.time + deltaTime * dayNightCycle.speed) % 1.0; // Cycle between 0 and 1

    // Calculate sun position (simple circular path)
    const angle = dayNightCycle.time * Math.PI * 2;
    directionalLight.position.set(
        Math.cos(angle) * 200,        // X position
        Math.sin(angle) * 150,        // Y position (sun height)
        directionalLight.position.z // Keep Z constant or vary it too
    );
     directionalLight.target.position.set(0, 0, 0); // Keep light pointing at the origin

    // Adjust light intensity and color
    const sunHeight = directionalLight.position.y;
    let intensity = 0;
    let skyColor = new THREE.Color(0x000010); // Night sky
    let ambientIntensity = 0.1;

    if (sunHeight > -20) { // Sun is up or near horizon
        intensity = Math.max(0, Math.min(1.5, sunHeight / 100)); // Intensity based on height
        ambientIntensity = Math.max(0.1, Math.min(0.4, sunHeight / 200));

        // Color interpolation (basic)
        const dayColor = new THREE.Color(0xffffff); // Midday sun
        const dawnDuskColor = new THREE.Color(0xffaa66); // Orange hue
         const zenithColor = new THREE.Color(0x87CEEB); // Day sky blue
         const horizonColor = new THREE.Color(0xFFD7A1); // Light orange horizon

         if (sunHeight > 50) { // High sun
            directionalLight.color.lerpColors(dawnDuskColor, dayColor, (sunHeight - 50) / 100);
            skyColor.lerpColors(horizonColor, zenithColor, (sunHeight - 50) / 100);
         } else if (sunHeight > 0) { // Rising/Setting sun
             directionalLight.color.copy(dawnDuskColor);
             skyColor.copy(horizonColor);
         } else { // Just below horizon (Twilight)
             const twilightFactor = 1.0 - Math.abs(sunHeight) / 20; // Fade out light/color
             directionalLight.color.copy(dawnDuskColor);
             skyColor.lerpColors(new THREE.Color(0x1a1a4a), horizonColor, twilightFactor * 0.5); // Dark blue/purple towards horizon
             intensity *= twilightFactor;
             ambientIntensity *= twilightFactor;
         }
    } else {
        // Night time
        intensity = 0; // Sun off
        ambientIntensity = 0.05; // Very dim moonlight
        skyColor = new THREE.Color(0x000010); // Deep blue/black
        // Could add a moon light source here
    }

    directionalLight.intensity = intensity;
    ambientLight.intensity = ambientIntensity;
    scene.background = skyColor; // Update background color

    // TODO: Update skybox texture based on time
    // TODO: Turn streetlights (emissive materials) on/off based on time
}


function updateAudio() {
    // Placeholder for updating sounds based on game state
    if (sounds.engine && sounds.engine.isPlaying) {
        // Adjust engine volume/pitch based on throttle and speed
        const baseVolume = 0.1;
        const throttleVolume = player.controls.throttle * 0.4;
        sounds.engine.setVolume(baseVolume + throttleVolume);

        // Adjust playback rate (pitch) based on speed/throttle (requires experimentation)
        // const basePlaybackRate = 0.8;
        // const speedFactor = Math.min(2.0, 1.0 + (player.physics.currentSpeed / 100));
        // sounds.engine.setPlaybackRate(basePlaybackRate * speedFactor);
    }

     if (sounds.wind && sounds.wind.isPlaying) {
        // Adjust wind volume based on speed
        // sounds.wind.setVolume(Math.min(1.0, player.physics.currentSpeed / 150));
    }
}

function playSound(sound) {
    // Placeholder for playing non-looping sounds
    if (sound && sound.isPlaying) {
        sound.stop(); // Stop previous play if still going
    }
    // sound?.play(); // Play the sound (using optional chaining)
    console.log("Placeholder: Play sound effect");
}


function syncMeshesWithBodies() {
    // Sync player
    if (player.mesh && player.body) {
        player.mesh.position.copy(player.body.position);
        player.mesh.quaternion.copy(player.body.quaternion);
    }

    // Sync city objects (only needed if they were dynamic, currently static)
    // for (let i = 0; i < cityObjects.meshes.length; i++) {
    //     cityObjects.meshes[i].position.copy(cityObjects.bodies[i].position);
    //     cityObjects.meshes[i].quaternion.copy(cityObjects.bodies[i].quaternion);
    // }

    // Sync AI Traffic
    // for (const vehicle of aiTraffic) {
    //     vehicle.mesh.position.copy(vehicle.body.position);
    //     vehicle.mesh.quaternion.copy(vehicle.body.quaternion);
    // }
}

// --- Game Loop ---

function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const deltaTime = Math.min(0.05, (currentTime - lastTime) / 1000); // Delta time in seconds, capped to prevent large jumps
    lastTime = currentTime;

    // 1. Update Controls Input State
    updatePlayerControls(deltaTime);

    // 2. Update Game Logic
    updateDayNightCycle(deltaTime);
    // updateAI(deltaTime); // TODO
    // checkCheckpoints(); // TODO
    // manageProceduralGeneration(); // TODO

    // 3. Update Physics World
    // Apply forces/torques based on controls *before* stepping the world
    updatePhysics(deltaTime);
    cannonWorld.step(1 / 60, deltaTime, 3); // Fixed time step, delta time, max sub-steps

    // 4. Sync Graphics with Physics
    syncMeshesWithBodies();

    // 5. Update Camera & Audio Listener Position
    updateCamera();
    updateAudio(); // Update sound properties

    // 6. Update HUD
    updateHUD();

    // 7. Render Scene
    // cannonDebugger?.update(); // Update debugger visualization if active
    renderer.render(scene, camera);
}

// --- Event Listeners ---

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Game Mode Logic (Basic) ---
function setGameMode(mode) {
    console.log("Setting game mode to:", mode);
    gameMode = mode;
    document.getElementById('mode-selection').style.display = 'none';
    resetSimulation(); // Reset positions, scores etc.

    if (mode === 'Endless') {
        // TODO: Activate procedural generation logic
        console.warn("Endless mode requires procedural generation implementation.");
    } else if (mode === 'Checkpoint') {
        // TODO: Create/show checkpoint markers
        console.warn("Checkpoint mode requires checkpoint logic and assets.");
    }
    // Free flight needs no special setup beyond the default city
}

function resetSimulation() {
    // Reset player position, velocity, orientation
    if (player.body) {
        player.body.position.set(0, 10, 0);
        player.body.velocity.set(0, 0, 0);
        player.body.angularVelocity.set(0, 0, 0);
        player.body.quaternion.set(0, 0, 0, 1); // Reset orientation
    }
    player.controls.throttle = 0;
    player.physics.isStalled = false;

    // TODO: Reset AI, checkpoints, score etc.
}


// --- Start Simulation ---
init();