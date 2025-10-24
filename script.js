// Initialize Three.js scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Orbit controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 18;

// Set background color
renderer.setClearColor(0x000000);

// Position camera
camera.position.z = 7.5;

// Create particles geometry and material
const particlesCount = 14000;
const positions = new Float32Array(particlesCount * 3);
const colors = new Float32Array(particlesCount * 3);

// Birthday colors: red, yellow, blue
const birthdayColors = [
    new THREE.Color(0xff0000), // Red
    new THREE.Color(0xffff00), // Yellow
    new THREE.Color(0x0000ff)  // Blue
];

// Initialize particles in random positions
for (let i = 0; i < particlesCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;     // x
    positions[i * 3 + 1] = (Math.random() - 0.5) * 20; // y
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20; // z

    // Assign random birthday colors
    const color = birthdayColors[Math.floor(Math.random() * birthdayColors.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
}

// Create geometry and material
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const material = new THREE.PointsMaterial({
    size: 0.035,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

// Create points object
const points = new THREE.Points(geometry, material);
scene.add(points);

// Animation variables
let animationPhase = 0; // no longer used for phased transitions
let animationTime = 0;
// Velocity array for sticky behavior
const velocities = new Float32Array(particlesCount * 3);

// Text formation positions (will be calculated)
let textPositions = [];
let initialPositions = [];

// Build point cloud from actual text glyphs using offscreen canvas
function buildTextPointCloud(text, {
    fontFamily = 'Bold 240px Arial',   // large for crisp sampling
    lineSpacing = 1.1,                 // line spacing multiplier
    canvasWidth = 2000,
    canvasHeight = 900,
    sampleStep = 5,                    // pixel step for sampling density (smaller = denser)
    alphaThreshold = 40,               // consider pixel as part of glyph if alpha above this
    worldScale = 0.0065               // scale to world units
} = {}) {
    const lines = text.split('\n');

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    // Background transparent
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Configure font and alignment
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontFamily;

    // Compute vertical layout
    const metrics = ctx.measureText('M');
    const lineHeightPx = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const totalHeight = lineHeightPx * lines.length * lineSpacing;

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    // Draw each line
    lines.forEach((line, idx) => {
        const y = centerY - totalHeight / 2 + (idx + 0.5) * lineHeightPx * lineSpacing;
        ctx.fillText(line, centerX, y);
    });

    // Read pixel data
    const { data } = ctx.getImageData(0, 0, canvasWidth, canvasHeight);

    // Find bounding box of drawn text for centering and scaling
    let minX = canvasWidth, minY = canvasHeight, maxX = 0, maxY = 0;
    for (let y = 0; y < canvasHeight; y += sampleStep) {
        for (let x = 0; x < canvasWidth; x += sampleStep) {
            const idx = (y * canvasWidth + x) * 4 + 3; // alpha channel
            if (data[idx] > alphaThreshold) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }

    const textWidth = Math.max(1, maxX - minX);
    const textHeight = Math.max(1, maxY - minY);

    // Sample points and convert to world coordinates centered at origin
    const points = [];
    for (let y = 0; y < canvasHeight; y += sampleStep) {
        for (let x = 0; x < canvasWidth; x += sampleStep) {
            const idx = (y * canvasWidth + x) * 4 + 3; // alpha channel
            if (data[idx] > alphaThreshold) {
                const nx = ((x - (minX + textWidth / 2)) * worldScale);
                const ny = (-(y - (minY + textHeight / 2)) * worldScale);
                points.push({ x: nx, y: ny, z: (Math.random() - 0.5) * 0.02 });
            }
        }
    }

    return points;
}

// Initialize text positions from glyph sampling
textPositions = buildTextPointCloud("HAPPY\nBIRTHDAY\nJOHN\nYOU ARE AWESOME!", {
    fontFamily: '900 180px Arial',   // smaller per-line to fit 4 lines
    lineSpacing: 1.12,
    canvasWidth: 2400,
    canvasHeight: 1500,
    sampleStep: 6,                   // adjust density; 4-8 works well
    alphaThreshold: 28,
    worldScale: 0.0072               // tune size in world units
});

// Store initial random positions
for (let i = 0; i < particlesCount; i++) {
    initialPositions.push({
        x: positions[i * 3],
        y: positions[i * 3 + 1],
        z: positions[i * 3 + 2]
    });
}

function animate() {
    requestAnimationFrame(animate);

    animationTime += 0.01;

    const pos = geometry.attributes.position.array;

    // Sticky-to-font behavior using a spring-damper toward target text positions
    // Parameters tuned for snappy settling with slight breathing motion.
    const stiffness = 0.12;   // spring constant
    const damping = 0.82;     // velocity damping
    const jitterAmp = 0.02;   // subtle breathing/jitter around the target

    for (let i = 0; i < particlesCount && i < textPositions.length; i++) {
        const tx = textPositions[i].x + Math.sin(animationTime * 1.2 + i * 0.07) * jitterAmp;
        const ty = textPositions[i].y + Math.cos(animationTime * 1.1 + i * 0.09) * jitterAmp;
        const tz = textPositions[i].z;

        const ix = i * 3;
        const iy = ix + 1;
        const iz = ix + 2;

        // Current position
        const px = pos[ix];
        const py = pos[iy];
        const pz = pos[iz];

        // Current velocity
        let vx = velocities[ix];
        let vy = velocities[iy];
        let vz = velocities[iz];

        // Spring force toward target
        vx += (tx - px) * stiffness;
        vy += (ty - py) * stiffness;
        vz += (tz - pz) * stiffness;

        // Damping
        vx *= damping;
        vy *= damping;
        vz *= damping;

        // Integrate
        pos[ix] = px + vx;
        pos[iy] = py + vy;
        pos[iz] = pz + vz;

        // Store velocity
        velocities[ix] = vx;
        velocities[iy] = vy;
        velocities[iz] = vz;
    }

    // Optionally keep extra particles (if any) orbiting around
    for (let i = textPositions.length; i < particlesCount; i++) {
        const ix = i * 3;
        const iy = ix + 1;
        const iz = ix + 2;
        const r = 0.2 + (i % 50) * 0.002;
        pos[ix] += Math.sin(animationTime + i * 0.05) * r * 0.01;
        pos[iy] += Math.cos(animationTime + i * 0.04) * r * 0.01;
        pos[iz] += Math.sin(animationTime + i * 0.03) * r * 0.01;
    }

    // Rotate the entire particle system slowly for depth
    points.rotation.y += 0.001;

    geometry.attributes.position.needsUpdate = true;

    controls.update();
    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();