// NO IMPORTS HERE - We rely on global THREE and CANNON objects
// from <script> tags in index.html

// --- Global Variables ---
// Check if libraries loaded globally (add this check at the very top)
if (typeof THREE === 'undefined') console.error("THREE.js failed to load!");
if (typeof CANNON === 'undefined') console.error("Cannon-es.js failed to load!");

let scene, camera, renderer, clock, cannonWorld, cannonDebugger; // cannonDebugger will be undefined if script not loaded
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

// Use the globally available THREE and CANNON
const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
// Add GLTFLoader, AudioLoader etc. if loading external assets (e.g., new THREE.AudioLoader(loadingManager))

// --- Constants ---
const G = 9.82; // Gravity
const KNOTS_TO_MS = 0.514444; // Conversion factor
const MS_TO_KNOTS = 1 / KNOTS_TO_MS;
const FEET_TO_METERS = 0.3048;
const METERS_TO_FEET = 1 / FEET_TO_METERS;

// --- Initialization ---

function init() {
    console.log("init() called"); // Log start
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
    // initCannonDebugger(); // Only call if debugger script is included in HTML

    // --- Loading Manager Callbacks ---
    loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
        console.log(`Loading started. Items to load: ${itemsTotal}`);
        // Ensure progress starts at 0% if there are items
        document.getElementById('loading-progress').textContent = itemsTotal > 0 ? `0%` : `Initializing...`;
    };

    loadingManager.onLoad = () => {
        console.log('Loading complete! Hiding loading screen and starting animation.');
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) { // Check if element exists
            loadingScreen.style.opacity = '0';
            // Use 'transitionend' event for more reliable hiding after fade
            loadingScreen.addEventListener('transitionend', () => {
                 if (loadingScreen.style.opacity === '0') { // Check if it faded out completely
                    loadingScreen.style.display = 'none';
                 }
            }, { once: true }); // Remove listener after it runs once
        } else {
            console.error("Loading screen element not found!");
        }
        // document.getElementById('mode-selection').style.display = 'block'; // Show mode buttons if needed
        lastTime = performance.now(); // Reset timer before starting loop
        console.log("Calling animate()...");
        animate(); // Start the main loop ONLY after loading
    };

     loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
        // This will only run if assets are actually loaded via the manager
         if (itemsTotal > 0) {
            const progress = Math.round((itemsLoaded / itemsTotal) * 100);
             document.getElementById('loading-progress').textContent = `${progress}%`;
             console.log(`Loading file: ${url} (${itemsLoaded}/${itemsTotal}) - ${progress}%`);
         }
    };

    loadingManager.onError = (url) => {
        console.error('There was an error loading ' + url);
         const loadingScreen = document.getElementById('loading-screen');
         if (loadingScreen) {
            loadingScreen.innerHTML = `<div>Error loading asset: ${url}. Check console (F12) & refresh.</div>`; // Show error
            loadingScreen.style.opacity = '1'; // Make sure error is visible
            loadingScreen.style.display = 'flex';
         }
         // Stop further processing on error? Maybe prevent animate() call?
    };

    // --- Handling the case where NO assets are loaded via the Manager ---
    // Check if the manager thinks it's idle *after* the current execution stack clears,
    // allowing time for any synchronous loader registrations (less common).
    setTimeout(() => {
        console.log(`Checking loading status. isLoading: ${loadingManager.isLoading}`);
        if (!loadingManager.isLoading) {
             // If nothing was ever added to the manager, onLoad won't fire automatically.
             // We need to trigger the completion sequence manually.
             console.log("Loading manager was idle, manually triggering onLoad sequence.");
             // Ensure progress shows 100% just before hiding
             document.getElementById('loading-progress').textContent = `100%`;
             loadingManager.onLoad(); // Manually call the load completion function
        }
    }, 10); // Very small delay, just enough to let the event loop run once.

    console.log("init() finished setup.");
}

function setupLoadingScreen() {
     // Reset progress text at the beginning
     document.getElementById('loading-progress').textContent = `Initializing...`;
     // Show loading screen if it was hidden
     const loadingScreen = document.getElementById('loading-screen');
     if (loadingScreen) {
        loadingScreen.style.display = 'flex';
        loadingScreen.style.opacity = '1';
     }
}


function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 20000); // Increased far plane
    camera.position.set(0, 15, -25);
    camera.lookAt(0, 5, 0);

    const canvas = document.getElementById('simulator-canvas');
    if (!canvas) {
        console.error("Simulator canvas element not found!");
        return; // Stop initialization if canvas missing
    }
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    clock = new THREE.Clock();
    window.addEventListener('resize', onWindowResize, false);
    console.log("Three.js initialized");
}

function initCannon() {
    cannonWorld = new CANNON.World();
    cannonWorld.gravity.set(0, -G, 0);
    cannonWorld.broadphase = new CANNON.SAPBroadphase(cannonWorld);

    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(
        defaultMaterial,
        defaultMaterial,
        { friction: 0.1, restitution: 0.2 }
    );
    cannonWorld.addContactMaterial(defaultContactMaterial);
    cannonWorld.defaultContactMaterial = defaultContactMaterial;
    console.log("Cannon-es initialized");
}

// Optional: Cannon Debugger (Only initialize if the script was included)
function initCannonDebugger() {
    // Check if the CannonDebugger class exists globally
    if (typeof CannonDebugger !== 'undefined') {
        cannonDebugger = new CannonDebugger(scene, cannonWorld, {
            color: 0x00ff00, // wireframe color
            // scale: 1.0, // Adjust scale if needed
        });
        console.log("Cannon-es debugger initialized");
    } else {
        console.warn("CannonDebugger script not loaded or class not found. Debugger disabled.");
        // Ensure cannonDebugger variable is not used if not initialized
        cannonDebugger = undefined; // Explicitly set to undefined
    }
}

function initLighting() {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(100, 150, 100);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 50;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -200;
    directionalLight.shadow.camera.right = 200;
    directionalLight.shadow.camera.top = 200;
    directionalLight.shadow.camera.bottom = -200;
    scene.add(directionalLight);
    scene.add(directionalLight.target);
    console.log("Lighting initialized");
}

function createSkybox() {
    scene.background = new THREE.Color(0x87CEEB); // Day sky color
    // Placeholder for potential CubeTexture loading using textureLoader
    console.log("Skybox created (solid color)");
}

function createGround() {
    // Three.js visual ground
    const groundGeometry = new THREE.PlaneGeometry(10000, 10000);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x556B2F,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Cannon.js physics ground
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0, material: cannonWorld.defaultContactMaterial });
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    cannonWorld.addBody(groundBody);
    console.log("Ground created");
}

function createPlayer() {
    // Three.js visual plane (Box placeholder)
    const planeGeometry = new THREE.BoxGeometry(10, 2, 8);
    const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.5, metalness: 0.3 });
    player.mesh = new THREE.Mesh(planeGeometry, planeMaterial);
    player.mesh.castShadow = true;
    player.mesh.position.set(0, 10, 0); // Starting position
    scene.add(player.mesh);

    // Cannon.js physics body
    const planeShape = new CANNON.Box(new CANNON.Vec3(5, 1, 4)); // Half-extents
    player.body = new CANNON.Body({
        mass: 500,
        position: new CANNON.Vec3(0, 10, 0),
        material: cannonWorld.defaultContactMaterial,
        linearDamping: 0.0, // Custom drag applied
        angularDamping: 0.5
    });
    player.body.addShape(planeShape);
    cannonWorld.addBody(player.body);

    player.body.addEventListener('collide', (event) => {
        console.log("Collision detected!");
        const impactVelocity = event.contact.getImpactVelocityAlongNormal();
        if (Math.abs(impactVelocity) > 2) {
             playSound(sounds.collision);
             // resetSimulation(); // Optional: Reset on hard collision
        }
    });
    console.log("Player created");
}

function createCity() {
    // Simple Procedural/Static City Placeholder (as before)
    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.8, metalness: 0.1 });
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.0 });
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });

    const gridSize = 10;
    const spacing = 150;
    const buildingHeightVariance = 80;
    const buildingBaseSize = 40;

    for (let i = -gridSize / 2; i < gridSize / 2; i++) {
        for (let j = -gridSize / 2; j < gridSize / 2; j++) {
            if (Math.random() > 0.3) { // Place building
                const height = 20 + Math.random() * buildingHeightVariance;
                const width = buildingBaseSize * (0.8 + Math.random() * 0.4);
                const depth = buildingBaseSize * (0.8 + Math.random() * 0.4);

                const buildingGeom = new THREE.BoxGeometry(width, height, depth);
                const buildingMesh = new THREE.Mesh(buildingGeom, buildingMaterial.clone());
                buildingMesh.castShadow = true;
                buildingMesh.receiveShadow = true;

                const x = i * spacing + (Math.random() - 0.5) * spacing * 0.3;
                const z = j * spacing + (Math.random() - 0.5) * spacing * 0.3;
                buildingMesh.position.set(x, height / 2, z);
                scene.add(buildingMesh);
                cityObjects.meshes.push(buildingMesh);

                // Physics Body
                const buildingShape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2));
                const buildingBody = new CANNON.Body({ mass: 0, material: cannonWorld.defaultContactMaterial }); // Static
                buildingBody.addShape(buildingShape);
                buildingBody.position.copy(buildingMesh.position);
                cannonWorld.addBody(buildingBody);
                cityObjects.bodies.push(buildingBody);

                 if (Math.random() < 0.2) { // Add streetlight
                    const poleHeight = 10;
                    const poleGeom = new THREE.CylinderGeometry(0.5, 0.5, poleHeight, 8);
                    const poleMesh = new THREE.Mesh(poleGeom, roadMaterial);
                    poleMesh.castShadow = true;
                    poleMesh.position.set(x + width/2 + 5, poleHeight/2, z);
                    scene.add(poleMesh);

                    const lightGeom = new THREE.SphereGeometry(1, 8, 8);
                    const lightMesh = new THREE.Mesh(lightGeom, lightMaterial);
                    lightMesh.position.set(x + width/2 + 5, poleHeight + 1, z);
                    scene.add(lightMesh);
                 }

            } else { // Place road segment
                 const roadGeom = new THREE.PlaneGeometry(spacing * 0.8, spacing * 0.8);
                 const roadMesh = new THREE.Mesh(roadGeom, roadMaterial);
                 roadMesh.rotation.x = -Math.PI / 2;
                 roadMesh.position.set(i * spacing, 0.05, j* spacing);
                 roadMesh.receiveShadow = true;
                 scene.add(roadMesh);
            }
        }
    }
    console.log("City created");
}


function initControls() {
    // Keyboard listeners (unchanged)
    const handleKeyDown = (event) => {
        switch (event.code) {
            case 'KeyW': player.controls.keyW = true; break;
            case 'KeyS': player.controls.keyS = true; break;
            case 'KeyA': player.controls.keyA = true; break;
            case 'KeyD': player.controls.keyD = true; break;
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

    // Touch Controls (unchanged, assumed correct logic)
    const joystickArea = document.getElementById('joystick-area');
    const throttleArea = document.getElementById('throttle-area');
    let joystickTouchId = null;
    let throttleTouchId = null;
    let joystickStartX = 0;
    const findTouch = (touchList, id) => { /* ... */ return null;}; // Ellipsis for brevity
    const updateThrottleFromTouch = (touch) => { /* ... */ }; // Ellipsis for brevity
    const handleJoystickEnd = (e) => { /* ... */ }; // Ellipsis for brevity
    const handleThrottleEnd = (e) => { /* ... */ }; // Ellipsis for brevity

    if (joystickArea && throttleArea) {
         joystickArea.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (joystickTouchId === null) {
                const touch = e.changedTouches[0];
                joystickTouchId = touch.identifier;
                joystickStartX = touch.clientX;
            }
        }, { passive: false });
         joystickArea.addEventListener('touchmove', (e) => {
             e.preventDefault();
             if (joystickTouchId !== null) {
                 const touch = findTouch(e.changedTouches, joystickTouchId);
                 if (touch) {
                     const deltaX = touch.clientX - joystickStartX;
                     const maxDelta = 60;
                     player.controls.yaw = Math.max(-1, Math.min(1, deltaX / maxDelta));
                     player.controls.roll = player.controls.yaw;
                 }
             }
         }, { passive: false });
        joystickArea.addEventListener('touchend', handleJoystickEnd);
        joystickArea.addEventListener('touchcancel', handleJoystickEnd);

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
                 if(touch) updateThrottleFromTouch(touch);
             }
        }, { passive: false });
         throttleArea.addEventListener('touchend', handleThrottleEnd);
         throttleArea.addEventListener('touchcancel', handleThrottleEnd);
         console.log("Touch controls initialized");
    } else {
        console.warn("Mobile control areas not found.");
    }

    console.log("Controls initialized");
}


function initHUD() {
    hudElements.throttle = document.getElementById('throttle-value');
    hudElements.speed = document.getElementById('speed-value');
    hudElements.altitude = document.getElementById('altitude-value');
    hudElements.compassNeedle = document.getElementById('compass-needle');
    hudElements.stallWarning = document.getElementById('stall-warning');
    hudElements.minimap = document.getElementById('minimap');
    hudElements.minimapPlayer = document.getElementById('minimap-player');
    // Basic check if elements were found
    if (!hudElements.throttle || !hudElements.speed || !hudElements.altitude || !hudElements.compassNeedle || !hudElements.stallWarning || !hudElements.minimap || !hudElements.minimapPlayer) {
        console.warn("One or more HUD elements were not found in the DOM!");
    } else {
        console.log("HUD elements linked");
    }
}

function initAudio() {
    // Placeholder - requires actual audio files and Web Audio API setup
    // Example using THREE.Audio (requires files)
    /*
    try {
        const listener = new THREE.AudioListener();
        camera.add(listener);
        const audioLoader = new THREE.AudioLoader(loadingManager); // Use the main manager

        sounds.engine = new THREE.PositionalAudio(listener);
        audioLoader.load('sounds/engine_loop.ogg', function(buffer) {
             sounds.engine.setBuffer(buffer);
             // ... set other properties ...
             if (player.mesh) player.mesh.add(sounds.engine);
             console.log("Engine sound loaded");
         }, undefined, function (err) { console.error("Error loading engine sound:", err); });

        // Load other sounds...
    } catch (error) {
        console.error("Error initializing audio:", error);
    }
    */
    console.warn("Audio setup is placeholder."); // Keep this warning
}

// --- Update Functions (largely unchanged, ensure no hidden errors) ---

function updatePlayerControls(deltaTime) {
    const throttleRate = 0.5 * deltaTime;

    if (player.controls.keyW) player.controls.throttle = Math.min(1.0, player.controls.throttle + throttleRate);
    else if (player.controls.keyS) player.controls.throttle = Math.max(0.0, player.controls.throttle - throttleRate);

    // Keyboard Yaw/Roll only if touch joystick inactive
    if (joystickTouchId === null) {
        const turnRate = 2.0 * deltaTime;
        if (player.controls.keyA) {
            player.controls.yaw = Math.max(-1, player.controls.yaw - turnRate);
            player.controls.roll = player.controls.yaw;
        } else if (player.controls.keyD) {
            player.controls.yaw = Math.min(1, player.controls.yaw + turnRate);
            player.controls.roll = player.controls.yaw;
        } else {
             player.controls.yaw *= (1 - turnRate * 1.5);
             player.controls.roll = player.controls.yaw;
             if (Math.abs(player.controls.yaw) < 0.01) player.controls.yaw = 0;
        }
    }
}


function updatePhysics(deltaTime) {
    if (!player.body || !player.mesh) return;

    const body = player.body;
    const controls = player.controls;
    const physics = player.physics;

    // Speed and Altitude
    const velocity = body.velocity;
    physics.currentSpeed = velocity.length();
    physics.altitude = body.position.y * METERS_TO_FEET;

    // Stall
    const speedKnots = physics.currentSpeed * MS_TO_KNOTS;
    physics.isStalled = speedKnots < physics.minStallSpeed && body.position.y > 3;

    // Orientation Vectors
    const forwardVector = new CANNON.Vec3(); body.quaternion.vmult(new CANNON.Vec3(0, 0, 1), forwardVector);
    const upVector = new CANNON.Vec3(); body.quaternion.vmult(new CANNON.Vec3(0, 1, 0), upVector);
    const rightVector = new CANNON.Vec3(); body.quaternion.vmult(new CANNON.Vec3(1, 0, 0), rightVector);

    // --- Forces ---
    // 1. Thrust
    const thrustForceMagnitude = controls.throttle * physics.maxThrottleForce;
    const thrustForce = forwardVector.scale(thrustForceMagnitude);
    body.applyForce(thrustForce, body.position);

    // 2. Lift
    let liftMagnitude = physics.liftCoefficient * physics.currentSpeed * physics.currentSpeed;
    if (physics.isStalled) liftMagnitude *= 0.15;
    const liftForce = upVector.scale(Math.max(0, liftMagnitude));
    body.applyForce(liftForce, body.position);

    // 3. Drag
    const dragMagnitude = physics.dragCoefficient * physics.currentSpeed * physics.currentSpeed;
    const dragForce = velocity.scale(-dragMagnitude);
    body.applyForce(dragForce, body.position);

    // 4. Gravity (handled by Cannon world)

    // --- Torques ---
    const torque = new CANNON.Vec3();
    const torqueFactor = 50;
    const speedFactor = Math.max(0.5, physics.currentSpeed / 10); // Effectiveness based on speed

    torque.z += -controls.roll * physics.rollSensitivity * torqueFactor * speedFactor; // Roll
    torque.y += -controls.yaw * physics.yawSensitivity * torqueFactor * speedFactor;   // Yaw
    // torque.x += controls.pitch * physics.pitchSensitivity * torqueFactor * speedFactor; // Pitch (if implemented)

    if (physics.isStalled) {
         torque.x += 0.1 * torqueFactor; // Gentle nose down stall recovery aid
    }

    body.applyLocalTorque(torque);
}

function updateCamera() {
    if (!player.mesh) return;

    const baseOffset = new THREE.Vector3(0, 5, -15);
    const targetOffset = baseOffset.clone().applyQuaternion(player.mesh.quaternion).add(player.mesh.position);
    camera.position.lerp(targetOffset, 0.08);

    const lookAtBase = new THREE.Vector3(0, 1, 5);
    const lookAtTarget = lookAtBase.clone().applyQuaternion(player.mesh.quaternion).add(player.mesh.position);
    camera.lookAt(lookAtTarget);
}

function updateHUD() {
    // Check elements exist before updating to prevent errors if init failed
    if (hudElements.throttle) hudElements.throttle.textContent = (player.controls.throttle * 100).toFixed(0);
    if (hudElements.speed) hudElements.speed.textContent = (player.physics.currentSpeed * MS_TO_KNOTS).toFixed(0);
    if (hudElements.altitude) hudElements.altitude.textContent = Math.max(0, player.physics.altitude).toFixed(0);

    // Compass
    if (player.mesh && hudElements.compassNeedle) {
        const forward = new THREE.Vector3(0, 0, 1);
        forward.applyQuaternion(player.mesh.quaternion);
        forward.y = 0;
        forward.normalize();
        const angleRad = Math.atan2(forward.x, forward.z);
        hudElements.compassNeedle.style.transform = `rotate(${-angleRad}rad)`;
        // Update text N,E,S,W logic (as before)
    }

    // Stall Warning
    if (hudElements.stallWarning) hudElements.stallWarning.style.display = player.physics.isStalled ? 'block' : 'none';

    // Minimap Player
     if (player.mesh && hudElements.minimapPlayer && hudElements.minimap) {
        try { // Add try-catch for robustness during calculation
            const mapWidth = hudElements.minimap.offsetWidth;
            const mapHeight = hudElements.minimap.offsetHeight;
            if (mapWidth > 0 && mapHeight > 0) { // Ensure map has dimensions
                const mapCenterX = mapWidth / 2;
                const mapCenterY = mapHeight / 2;
                const mapX = player.mesh.position.x / minimap.scale;
                const mapY = -player.mesh.position.z / minimap.scale;
                const markerX = mapCenterX + mapX;
                const markerY = mapCenterY + mapY;

                const forward = new THREE.Vector3(0, 0, 1);
                forward.applyQuaternion(player.mesh.quaternion);
                const mapAngleRad = Math.atan2(forward.x, forward.z);

                hudElements.minimapPlayer.style.left = `${markerX}px`;
                hudElements.minimapPlayer.style.top = `${markerY}px`;
                hudElements.minimapPlayer.style.transform = `translate(-50%, -50%) rotate(${mapAngleRad}rad)`;
            }
        } catch (error) {
            console.error("Error updating minimap:", error);
            // Avoid continuously throwing error if map dimensions are broken
            if (hudElements.minimap) hudElements.minimap.style.border = "1px solid red"; // Indicate error visually
        }
    }
}

function updateDayNightCycle(deltaTime) {
    // Day/Night cycle logic (unchanged)
    dayNightCycle.time = (dayNightCycle.time + deltaTime * dayNightCycle.speed) % 1.0;
    const angle = dayNightCycle.time * Math.PI * 2;
    const sunDistance = 300;
    const maxHeight = 200;
    directionalLight.position.set(
        0,
        Math.sin(angle) * maxHeight,
        Math.cos(angle) * sunDistance
    );
     directionalLight.target.position.set(0, 0, 0);

    const sunHeight = directionalLight.position.y;
    let intensity = 0;
    let skyColor = new THREE.Color(0x000010);
    let ambientIntensity = 0.05;
    const horizonY = -30;
    const fullDayY = 50;

    if (sunHeight > horizonY) {
        const transition = Math.min(1, Math.max(0, (sunHeight - horizonY) / (fullDayY - horizonY)));
        intensity = transition * 1.2;
        ambientIntensity = 0.05 + transition * 0.35;
        const daySunColor = new THREE.Color(0xffffff);
        const dawnDuskSunColor = new THREE.Color(0xffaa66);
        const daySkyColor = new THREE.Color(0x87CEEB);
        const dawnDuskSkyColor = new THREE.Color(0xFFD7A1);
        const nightSkyColor = new THREE.Color(0x000010);
        directionalLight.color.lerpColors(dawnDuskSunColor, daySunColor, Math.min(1, Math.max(0, sunHeight / fullDayY)));
         if (sunHeight > fullDayY * 0.5) {
            skyColor.lerpColors(dawnDuskSkyColor, daySkyColor, Math.min(1, Math.max(0, (sunHeight - fullDayY*0.5) / (maxHeight - fullDayY*0.5))));
         } else if (sunHeight > horizonY) {
             skyColor.lerpColors(nightSkyColor, dawnDuskSkyColor, transition);
         }
    }

    directionalLight.intensity = intensity;
    ambientLight.intensity = ambientIntensity;
    if (scene.background instanceof THREE.Color) {
        scene.background.copy(skyColor);
    }
}


function updateAudio() {
    // Placeholder (unchanged)
    // Add logic to adjust volume/pitch based on player state
}

function playSound(sound) {
    // Placeholder (unchanged)
     console.log("Placeholder: Play sound effect");
}


function syncMeshesWithBodies() {
    // Sync player (unchanged)
    if (player.mesh && player.body) {
        player.mesh.position.copy(player.body.position);
        player.mesh.quaternion.copy(player.body.quaternion);
    }
    // Static city objects don't need syncing
    // Sync AI Traffic if implemented
}

// --- Game Loop ---
let frameCount = 0; // Add frame counter for debugging

function animate() {
    // Request the next frame *first*
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const rawDeltaTime = (currentTime - lastTime) / 1000;
    const deltaTime = Math.min(rawDeltaTime, 1 / 20); // Clamp delta time
    lastTime = currentTime;

    // Basic check to prevent execution if core components missing
    if (!scene || !camera || !renderer || !cannonWorld || !player.body) {
        console.error("Animation loop stopped: core component missing.");
        return;
    }

    try { // Wrap the main loop body in try-catch for debugging
        // --- Simulation Steps ---
        updatePlayerControls(deltaTime);
        updateDayNightCycle(deltaTime);
        // updateAI(deltaTime);
        // checkGameRules();
        // manageProceduralGeneration();

        updatePhysics(deltaTime); // Apply forces BEFORE stepping

        const fixedTimeStep = 1 / 60;
        const maxSubSteps = 5;
        cannonWorld.step(fixedTimeStep, deltaTime, maxSubSteps);

        syncMeshesWithBodies(); // Update visuals AFTER stepping

        updateCamera();
        updateAudio();
        updateHUD();

        // Render Scene
        if (cannonDebugger) cannonDebugger.update(); // Update debugger if it exists
        renderer.render(scene, camera);

        frameCount++;
        // if (frameCount % 300 == 0) console.log("Animate loop running... Frame:", frameCount); // Periodic log

    } catch (error) {
        console.error("Error in animate loop:", error);
        // Consider stopping the loop or showing an error overlay
        // For now, just log it to avoid infinite errors if possible
    }
}

// --- Event Listeners ---

function onWindowResize() {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        console.log("Window resized");
    }
}

// --- Game Mode Logic (unchanged) ---
function setGameMode(mode) { /* ... */ }
function resetSimulation() { /* ... */ }


// --- Start Simulation ---
// Use DOMContentLoaded for safety
function startInitialization() {
    console.log("DOM fully loaded. Starting initialization...");
    init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInitialization);
} else {
    startInitialization(); // DOM is already ready
}