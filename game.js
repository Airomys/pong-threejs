/* ══════════════════════════════════════════════════════════════
   PONG 3D – Neon Arena  |  game.js
   Three.js r128 – Vanilla JS – versione corretta
   ══════════════════════════════════════════════════════════════ */
'use strict';

// ─────────────────────────────────────────────
//  COSTANTI
// ─────────────────────────────────────────────
const FIELD_W          = 28;
const FIELD_H          = 16;
const PADDLE_W         = 0.4;
const PADDLE_H         = 3.4;
const PADDLE_D         = 0.4;
const BALL_RADIUS      = 0.28;
const SCORE_LIMIT      = 7;
const PADDLE_SPEED     = 14;
const BALL_BASE_SPEED  = 10;
const BALL_SPEED_INC   = 0.6;
const AI_SPEED         = { easy: 0.038, medium: 0.062, hard: 0.094 };

// ─────────────────────────────────────────────
//  STATO
// ─────────────────────────────────────────────
let state = {
  mode:       'ai',
  difficulty: 'medium',
  running:    false,
  paused:     false,
  score:      [0, 0],
  phase:      'idle'   // idle | countdown | playing | gameover
};

let keys    = {};
let ball    = { x: 0, y: 0, vx: 1, vy: 0, speed: BALL_BASE_SPEED };
let paddles = { left: 0, right: 0 };
let paddleVel = { left: 0, right: 0 };  // velocità corrente dei paddle

// Touch
let touchState = { left: { id: null, y: null }, right: { id: null, y: null } };

// ─────────────────────────────────────────────
//  RENDERER
// ─────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x040412);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 24);
camera.lookAt(0, 0, 0);

function onResize() {
  const targetAspect = 16 / 9;
  let w = window.innerWidth;
  let h = window.innerHeight;
  
  if (w / h > targetAspect) {
    w = h * targetAspect; // Schermo troppo largo
  } else {
    h = w / targetAspect; // Schermo troppo alto
  }
  
  renderer.setSize(w, h);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  
  camera.aspect = targetAspect;
  const fovRad = (camera.fov * Math.PI) / 360;
  const requiredZ = (FIELD_W + 4) / (2 * Math.tan(fovRad) * targetAspect);
  camera.position.z = Math.max(24, requiredZ);
  
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => {
  if (Math.abs(window.orientation) === 90) { // Landscape
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }
});
onResize();

// ─────────────────────────────────────────────
//  HELPER: texture glow circolare
// ─────────────────────────────────────────────
function makeGlowTexture(r, g, b) {
  const size = 128;
  const c    = document.createElement('canvas');
  c.width = c.height = size;
  const ctx  = c.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0,   `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// ─────────────────────────────────────────────
//  MATERIALI
// ─────────────────────────────────────────────
const matField = new THREE.MeshStandardMaterial({ color: 0x050520, roughness: 0.9, metalness: 0.1 });

const matPaddleL = new THREE.MeshStandardMaterial({
  color: 0x00f5ff, emissive: 0x00f5ff, emissiveIntensity: 0.9,
  roughness: 0.2, metalness: 0.8
});
const matPaddleR = new THREE.MeshStandardMaterial({
  color: 0xff007a, emissive: 0xff007a, emissiveIntensity: 0.9,
  roughness: 0.2, metalness: 0.8
});
const matBall = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0xffd700, emissiveIntensity: 1.3,
  roughness: 0.1, metalness: 0.4
});
const matWall = new THREE.MeshStandardMaterial({
  color: 0x0a0a30, emissive: 0x00f5ff, emissiveIntensity: 0.08,
  roughness: 0.9, transparent: true, opacity: 0.55
});
const matWallGlow = new THREE.MeshBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.3 });
const matCenterLine = new THREE.MeshBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.2 });
const matGrid = new THREE.LineBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.07 });
const matCircle = new THREE.LineBasicMaterial({ color: 0x00f5ff, transparent: true, opacity: 0.22 });

// ─────────────────────────────────────────────
//  POWER-UPS SYSTEM
// ─────────────────────────────────────────────
const powerUpTypes = ['speed', 'slow', 'enlarge'];
const powerUpColors = { 'speed': 0xffa500, 'slow': 0x00bfff, 'enlarge': 0x32cd32 };
let powerups = []; // { mesh, type, x, y }
let activeEffects = { enlargeL: 0, enlargeR: 0 };
let lastHit = null; // 'left' or 'right'

function spawnPowerUp() {
  if (state.phase !== 'playing' || powerups.length >= 2) return;
  const type = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
  const px = (Math.random() - 0.5) * (FIELD_W * 0.6);
  const py = (Math.random() - 0.5) * (FIELD_H * 0.7);
  
  const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const mat = new THREE.MeshStandardMaterial({ 
    color: powerUpColors[type], emissive: powerUpColors[type], emissiveIntensity: 0.8 
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(px, py, 0);
  scene.add(mesh);
  
  powerups.push({ mesh, type, x: px, y: py });
}
setInterval(spawnPowerUp, 7000); // Prova a generare ogni 7 secondi

// ─────────────────────────────────────────────
//  COSTRUZIONE SCENA
// ─────────────────────────────────────────────
let meshBall, meshPaddleL, meshPaddleR;
let lightBall, lightLeft, lightRight;
let sprBallGlow;

function buildScene() {
  // Piano di sfondo
  const fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W + 4, FIELD_H + 4), matField);
  fieldMesh.rotation.x = -Math.PI / 2;
  fieldMesh.position.y = -FIELD_H / 2 - 0.02;
  fieldMesh.receiveShadow = true;
  scene.add(fieldMesh);

  // Griglia manuale (evita il problema .material di GridHelper in r128)
  const gridGeo = new THREE.BufferGeometry();
  const gridVerts = [];
  const step = FIELD_W / 14;
  for (let i = 0; i <= 14; i++) {
    const x = -FIELD_W / 2 + i * step;
    gridVerts.push(x, -FIELD_H/2, 0,  x,  FIELD_H/2, 0);
  }
  const stepH = FIELD_H / 8;
  for (let j = 0; j <= 8; j++) {
    const y = -FIELD_H / 2 + j * stepH;
    gridVerts.push(-FIELD_W/2, y, 0,  FIELD_W/2, y, 0);
  }
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
  scene.add(new THREE.LineSegments(gridGeo, matGrid));

  // Linea centrale
  const centerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, FIELD_H, 0.06), matCenterLine);
  scene.add(centerMesh);

  // Cerchio centrale
  const circlePts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    circlePts.push(new THREE.Vector3(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts), matCircle));

  // Muri top/bottom
  const wallGeo = new THREE.BoxGeometry(FIELD_W, 0.32, 0.32);
  const wallTop = new THREE.Mesh(wallGeo, matWall);
  wallTop.position.y = FIELD_H / 2;
  scene.add(wallTop);
  const wallBot = new THREE.Mesh(wallGeo, matWall.clone());
  wallBot.position.y = -FIELD_H / 2;
  scene.add(wallBot);

  // Bordi luminosi sui muri
  const edgeGeo  = new THREE.BoxGeometry(FIELD_W, 0.045, 0.045);
  const edgeTop  = new THREE.Mesh(edgeGeo, matWallGlow);
  edgeTop.position.y = FIELD_H / 2;
  scene.add(edgeTop);
  const edgeBot  = new THREE.Mesh(edgeGeo, matWallGlow.clone());
  edgeBot.position.y = -FIELD_H / 2;
  scene.add(edgeBot);

  // Paddle sinistro
  const paddleGeo = new THREE.BoxGeometry(PADDLE_W, PADDLE_H, PADDLE_D);
  meshPaddleL = new THREE.Mesh(paddleGeo, matPaddleL);
  meshPaddleL.position.x = -(FIELD_W / 2 - 1.0);
  meshPaddleL.castShadow = true;
  scene.add(meshPaddleL);

  // Paddle destro
  meshPaddleR = new THREE.Mesh(paddleGeo.clone(), matPaddleR);
  meshPaddleR.position.x = FIELD_W / 2 - 1.0;
  meshPaddleR.castShadow = true;
  scene.add(meshPaddleR);

  // Palla
  meshBall = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 24), matBall);
  meshBall.castShadow = true;
  scene.add(meshBall);

  // Sprite glow sulla palla
  sprBallGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(255, 215, 0),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }));
  sprBallGlow.scale.set(2.6, 2.6, 1);
  scene.add(sprBallGlow);
}

// ─────────────────────────────────────────────
//  LUCI
// ─────────────────────────────────────────────
function buildLights() {
  scene.add(new THREE.AmbientLight(0x0a0a2a, 0.7));

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 15);
  dir.castShadow = true;
  scene.add(dir);

  lightLeft = new THREE.PointLight(0x00f5ff, 2.8, 20);
  lightLeft.position.set(-(FIELD_W / 2 - 1), 0, 4);
  scene.add(lightLeft);

  lightRight = new THREE.PointLight(0xff007a, 2.8, 20);
  lightRight.position.set(FIELD_W / 2 - 1, 0, 4);
  scene.add(lightRight);

  lightBall = new THREE.PointLight(0xffd700, 4, 10);
  scene.add(lightBall);
}

// ─────────────────────────────────────────────
//  TRAIL PARTICELLE
// ─────────────────────────────────────────────
const TRAIL_COUNT  = 45;
const trailPos     = new Float32Array(TRAIL_COUNT * 3);
const trailHistory = [];
let trailGeo, trailMesh;

function buildTrail() {
  trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailMesh = new THREE.Points(trailGeo, new THREE.PointsMaterial({
    color: 0xffd700, size: 0.2,
    transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  scene.add(trailMesh);
}

function updateTrail() {
  trailHistory.unshift({ x: ball.x, y: ball.y });
  if (trailHistory.length > TRAIL_COUNT) trailHistory.pop();
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const p = trailHistory[i] || { x: ball.x, y: ball.y };
    trailPos[i * 3]     = p.x;
    trailPos[i * 3 + 1] = p.y;
    trailPos[i * 3 + 2] = 0;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailMesh.material.opacity = state.phase === 'playing' ? 0.75 : 0;
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
buildScene();
buildLights();
buildTrail();

// ─────────────────────────────────────────────
//  UI
// ─────────────────────────────────────────────
const menuOverlay     = document.getElementById('menu-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const hud             = document.getElementById('hud');
const elScoreL        = document.getElementById('score-left');
const elScoreR        = document.getElementById('score-right');
const elLabelL        = document.getElementById('label-left');
const elLabelR        = document.getElementById('label-right');
const elCountdown     = document.getElementById('countdown');
const elWinner        = document.getElementById('winner-text');
const elFinalScore    = document.getElementById('final-score');

document.getElementById('btn-vs-ai').addEventListener('click', () => {
  state.mode = 'ai';
  document.getElementById('btn-vs-ai').classList.add('active');
  document.getElementById('btn-vs-player').classList.remove('active');
  document.getElementById('difficulty-section').style.display = '';
});
document.getElementById('btn-vs-player').addEventListener('click', () => {
  state.mode = '2p';
  document.getElementById('btn-vs-player').classList.add('active');
  document.getElementById('btn-vs-ai').classList.remove('active');
  document.getElementById('difficulty-section').style.display = 'none';
});

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.difficulty = btn.dataset.diff;
  });
});

document.getElementById('btn-start').addEventListener('click',   startGame);
document.getElementById('btn-rematch').addEventListener('click', startGame);
document.getElementById('btn-menu').addEventListener('click', goToMenu);
document.getElementById('btn-pause').addEventListener('click', togglePause);

// ── Tastiera: blocca scroll pagina sui tasti di gioco ──
const GAME_KEYS = new Set(['KeyW','KeyS','ArrowUp','ArrowDown','Space']);
window.addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  delete keys[e.code];
});

// ── Touch: metà sinistra = P1, metà destra = P2 ──
window.addEventListener('touchstart', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const norm = 1 - (t.clientY / window.innerHeight) * 2;
    if (t.clientX < window.innerWidth / 2) {
      if (touchState.left.id === null) { touchState.left.id = t.identifier; touchState.left.y = norm; }
    } else {
      if (touchState.right.id === null) { touchState.right.id = t.identifier; touchState.right.y = norm; }
    }
  }
}, { passive: false });

window.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.touches) {
    const norm = 1 - (t.clientY / window.innerHeight) * 2;
    if (t.identifier === touchState.left.id) touchState.left.y = norm;
    else if (t.identifier === touchState.right.id) touchState.right.y = norm;
  }
}, { passive: false });

function handleTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touchState.left.id) { touchState.left.id = null; touchState.left.y = null; }
    if (t.identifier === touchState.right.id) { touchState.right.id = null; touchState.right.y = null; }
  }
}
window.addEventListener('touchend', handleTouchEnd);
window.addEventListener('touchcancel', handleTouchEnd);

// ─────────────────────────────────────────────
//  GAME FLOW
// ─────────────────────────────────────────────
function startGame() {
  // Richiesta Fullscreen e blocco orientamento con fallback di sicurezza per vecchi browser
  try {
    if (document.documentElement.requestFullscreen) {
      const fsPromise = document.documentElement.requestFullscreen();
      if (fsPromise && fsPromise.then) {
        fsPromise.then(() => {
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
          }
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Fullscreen non supportato', err);
  }

  state.score   = [0, 0];
  state.paused  = false;
  state.running = true;

  elScoreL.textContent = '0';
  elScoreR.textContent = '0';
  elLabelL.textContent = 'GIOCATORE';
  elLabelR.textContent = state.mode === 'ai' ? 'IA' : 'GIOC. 2';

  paddles.left  = 0;
  paddles.right = 0;

  menuOverlay.classList.remove('active');
  gameoverOverlay.classList.remove('active');
  hud.classList.remove('hidden');

  beginRound();
}

function goToMenu() {
  state.phase   = 'idle';
  state.running = false;
  gameoverOverlay.classList.remove('active');
  menuOverlay.classList.add('active');
  hud.classList.add('hidden');
  resetBall();
  trailHistory.length = 0;
}

function beginRound() {
  state.phase = 'countdown';
  resetBall();
  trailHistory.length = 0;
  
  powerups.forEach(pu => scene.remove(pu.mesh));
  powerups = [];
  activeEffects = { enlargeL: 0, enlargeR: 0 };
  if (meshPaddleL) meshPaddleL.scale.y = 1;
  if (meshPaddleR) meshPaddleR.scale.y = 1;
  lastHit = null;

  let count = 3;
  showCountdown(count);

  const iv = setInterval(() => {
    count--;
    if (count > 0) {
      showCountdown(count);
    } else {
      clearInterval(iv);
      elCountdown.textContent  = 'VIA!';
      elCountdown.style.color  = '#ffd700';
      elCountdown.classList.remove('hidden');
      setTimeout(() => {
        elCountdown.classList.add('hidden');
        elCountdown.style.color = '';
        state.phase = 'playing';
      }, 700);
    }
  }, 900);
}

function showCountdown(n) {
  elCountdown.classList.add('hidden');      // reset animazione
  void elCountdown.offsetWidth;            // reflow
  elCountdown.textContent = n;
  elCountdown.style.color = '';
  elCountdown.classList.remove('hidden');
}

function resetBall() {
  ball.x = 0; ball.y = 0;
  ball.speed = BALL_BASE_SPEED;
  const angle = (Math.random() * 0.55 - 0.275);
  const dir   = Math.random() > 0.5 ? 1 : -1;
  ball.vx = Math.cos(angle) * dir;
  ball.vy = Math.sin(angle);
  const len = Math.hypot(ball.vx, ball.vy);
  ball.vx /= len; ball.vy /= len;
  updateAITargetError();
}

function togglePause() {
  if (state.phase !== 'playing' && state.phase !== 'countdown') return;
  state.paused = !state.paused;
  document.getElementById('btn-pause').textContent = state.paused ? '▶' : '⏸';
}

function scorePoint(playerIdx) {
  state.score[playerIdx]++;
  cameraShake = 0.38;

  const els = [elScoreL, elScoreR];
  els[playerIdx].textContent = state.score[playerIdx];
  els[playerIdx].classList.add('pop');
  setTimeout(() => els[playerIdx].classList.remove('pop'), 320);

  state.phase = 'idle';

  if (state.score[playerIdx] >= SCORE_LIMIT) {
    setTimeout(() => showGameOver(playerIdx), 700);
  } else {
    setTimeout(() => beginRound(), 1100);
  }
}

function showGameOver(winner) {
  state.phase   = 'gameover';
  state.running = false;

  const names = state.mode === 'ai' ? ['GIOCATORE', 'IA'] : ['GIOCATORE 1', 'GIOCATORE 2'];
  elWinner.textContent     = `🏆 ${names[winner]} VINCE!`;
  elFinalScore.textContent = `${state.score[0]} : ${state.score[1]}`;

  gameoverOverlay.classList.add('active');
  hud.classList.add('hidden');
}

// ─────────────────────────────────────────────
//  UPDATE FISICA
// ─────────────────────────────────────────────
// ── Parametri movimento paddle ──
const P_ACCEL  = 90;   // accelerazione (unità/s²)
const P_MAX    = PADDLE_SPEED;
const P_DAMP   = 0.08; // smorzamento al rilascio (0=stop istantaneo, 1=nessun freno)

function getPaddleH(side) {
  return PADDLE_H * (side === 'left' ? meshPaddleL.scale.y : meshPaddleR.scale.y);
}

function maxPY(side) {
  return FIELD_H / 2 - getPaddleH(side) / 2 - 0.05;
}

function movePaddle(side, upKey, downKey, dt) {
  const limit = maxPY(side);

  if (touchState[side].id !== null && touchState[side].y !== null) {
    // Touch: posizionamento diretto, smorzato
    const target = touchState[side].y * limit;
    paddleVel[side]  = (target - paddles[side]) / dt * 0.35;
    paddles[side]   += (target - paddles[side]) * Math.min(1, 14 * dt);
  } else if (keys[upKey]) {
    paddleVel[side] = Math.min(paddleVel[side] + P_ACCEL * dt, P_MAX);
  } else if (keys[downKey]) {
    paddleVel[side] = Math.max(paddleVel[side] - P_ACCEL * dt, -P_MAX);
  } else {
    // Nessun tasto → smorzamento graduale, si ferma dove si trova
    paddleVel[side] *= P_DAMP;
    if (Math.abs(paddleVel[side]) < 0.01) paddleVel[side] = 0;
  }

  paddles[side] += paddleVel[side] * dt;
  // Clamp + rimbalzo elastico sui bordi
  if (paddles[side] > limit)  { paddles[side] =  limit;  paddleVel[side] = 0; }
  if (paddles[side] < -limit) { paddles[side] = -limit; paddleVel[side] = 0; }
}

function update(dt) {
  if (!state.running || state.paused || state.phase !== 'playing') return;

  // Giocatore 1 → W (su) / S (giù)
  movePaddle('left',  'KeyW', 'KeyS', dt);

  // Giocatore 2 / IA
  if (state.mode === '2p') {
    movePaddle('right', 'ArrowUp', 'ArrowDown', dt);
  } else {
    updateAI(dt);
  }

  // Muovi palla
  ball.x += ball.vx * ball.speed * dt;
  ball.y += ball.vy * ball.speed * dt;

  // Rimbalzo muri
  const wallY = FIELD_H / 2 - BALL_RADIUS;
  if (ball.y > wallY)  { ball.y =  wallY; ball.vy = -Math.abs(ball.vy); cameraShake = 0.07; updateAITargetError(); }
  if (ball.y < -wallY) { ball.y = -wallY; ball.vy =  Math.abs(ball.vy); cameraShake = 0.07; updateAITargetError(); }

  // Collisioni paddle
  collidePaddle();
  
  // Power Ups
  updatePowerUps(dt);

  // Gol
  const goalX = FIELD_W / 2 + 1;
  if (ball.x < -goalX) { scorePoint(1); return; }
  if (ball.x >  goalX) { scorePoint(0); return; }
}

function updatePowerUps(dt) {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    pu.mesh.rotation.x += dt * 2;
    pu.mesh.rotation.y += dt * 3;
    
    // Collisione palla
    const dx = ball.x - pu.x;
    const dy = ball.y - pu.y;
    if (Math.hypot(dx, dy) < BALL_RADIUS + 0.6) {
      if (pu.type === 'speed') {
        ball.speed = Math.min(ball.speed * 1.6, 30);
      } else if (pu.type === 'slow') {
        ball.speed = Math.max(ball.speed * 0.55, 8);
      } else if (pu.type === 'enlarge' && lastHit) {
        if (lastHit === 'left') activeEffects.enlargeL = 5; // 5 secondi
        else activeEffects.enlargeR = 5;
      }
      scene.remove(pu.mesh);
      powerups.splice(i, 1);
    }
  }
  
  // Gestione timer ingrandimento
  if (activeEffects.enlargeL > 0) activeEffects.enlargeL -= dt;
  if (activeEffects.enlargeR > 0) activeEffects.enlargeR -= dt;
  
  meshPaddleL.scale.y = activeEffects.enlargeL > 0 ? 1.6 : 1;
  meshPaddleR.scale.y = activeEffects.enlargeR > 0 ? 1.6 : 1;
}

function collidePaddle() {
  // ── Paddle sinistro ──
  const lx  = -(FIELD_W / 2 - 1.0);
  const lFront = lx + PADDLE_W / 2 + BALL_RADIUS;
  const pHL = getPaddleH('left');
  if (ball.vx < 0 && ball.x <= lFront && ball.x >= lx - PADDLE_W / 2) {
    if (Math.abs(ball.y - paddles.left) < pHL / 2 + BALL_RADIUS * 0.6) {
      ball.x = lFront;
      lastHit = 'left';
      deflect(paddles.left, 1, pHL);
    }
  }

  // ── Paddle destro ──
  const rx  = FIELD_W / 2 - 1.0;
  const rFront = rx - PADDLE_W / 2 - BALL_RADIUS;
  const pHR = getPaddleH('right');
  if (ball.vx > 0 && ball.x >= rFront && ball.x <= rx + PADDLE_W / 2) {
    if (Math.abs(ball.y - paddles.right) < pHR / 2 + BALL_RADIUS * 0.6) {
      ball.x = rFront;
      lastHit = 'right';
      deflect(paddles.right, -1, pHR);
    }
  }
}

function deflect(paddleY, dirX, currentPaddleH) {
  const relHit = Math.max(-1, Math.min(1, (ball.y - paddleY) / (currentPaddleH / 2)));
  const angle  = relHit * 0.82; // max ~47°
  ball.vx = Math.cos(angle) * dirX;
  ball.vy = Math.sin(angle);
  const len = Math.hypot(ball.vx, ball.vy);
  ball.vx /= len; ball.vy /= len;
  ball.speed = Math.min(ball.speed + BALL_SPEED_INC, 26);
  cameraShake = 0.14;
  updateAITargetError(); // Ricalcola errore IA

  // Flash paddle
  const mat = dirX > 0 ? matPaddleL : matPaddleR;
  const orig = mat.emissiveIntensity;
  mat.emissiveIntensity = 4;
  setTimeout(() => { mat.emissiveIntensity = orig; }, 110);
}

// ─────────────────────────────────────────────
//  IA
// ─────────────────────────────────────────────
let aiTargetOffset = 0;

function updateAITargetError() {
  const diff = state.difficulty;
  const missChance = diff === 'easy' ? 0.30 : diff === 'medium' ? 0.10 : 0.02;
  
  if (Math.random() < missChance) {
    // Errore critico: manca la palla
    const sign = Math.random() > 0.5 ? 1 : -1;
    aiTargetOffset = sign * (PADDLE_H * 1.5 + BALL_RADIUS * 2);
  } else {
    // Imprecisione standard
    const err = diff === 'easy' ? 1.5 : diff === 'medium' ? 0.7 : 0.15;
    aiTargetOffset = (Math.random() - 0.5) * err;
  }
}

function updateAI(dt) {
  const speedFactor = AI_SPEED[state.difficulty] || AI_SPEED.medium;
  let target = predictBallY();

  // Usa l'offset calcolato
  target += aiTargetOffset;
  target = Math.max(-maxPY('right'), Math.min(maxPY('right'), target));

  const diff = target - paddles.right;
  const step = Math.sign(diff) * Math.min(Math.abs(diff), PADDLE_SPEED * speedFactor * 60 * dt);
  paddles.right = Math.max(-maxPY('right'), Math.min(maxPY('right'), paddles.right + step));
}

function predictBallY() {
  if (ball.vx <= 0) return 0; // palla si allontana → centro
  let px = ball.x, py = ball.y, pvy = ball.vy;
  const wallY  = FIELD_H / 2 - BALL_RADIUS;
  const tgt    = FIELD_W / 2 - 1.0;
  const tRemain = (tgt - px) / (ball.vx * ball.speed);
  const steps  = 80;
  const dtSim  = tRemain / steps;
  for (let i = 0; i < steps; i++) {
    py += pvy * ball.speed * dtSim;
    if (py > wallY)  { py =  wallY; pvy = -Math.abs(pvy); }
    if (py < -wallY) { py = -wallY; pvy =  Math.abs(pvy); }
  }
  return py;
}

// ─────────────────────────────────────────────
//  CAMERA SHAKE
// ─────────────────────────────────────────────
let cameraShake = 0;

function applyCameraShake(dt) {
  if (cameraShake > 0) {
    camera.position.x += (Math.random() - 0.5) * cameraShake * 2;
    camera.position.y += (Math.random() - 0.5) * cameraShake * 2;
    cameraShake = Math.max(0, cameraShake - dt * 3.5);
  } else {
    camera.position.x += (0 - camera.position.x) * 6 * dt;
    camera.position.y += (0 - camera.position.y) * 6 * dt;
  }
}

// ─────────────────────────────────────────────
//  SINCRONIZZAZIONE OGGETTI 3D
// ─────────────────────────────────────────────
function syncMeshes(dt) {
  // Paddle
  meshPaddleL.position.y = paddles.left;
  meshPaddleR.position.y = paddles.right;

  // Palla
  meshBall.position.set(ball.x, ball.y, 0);
  meshBall.rotation.z += 0.05;
  meshBall.rotation.x += 0.04;

  // Glow sprite + luce palla
  sprBallGlow.position.set(ball.x, ball.y, 0.2);
  lightBall.position.set(ball.x, ball.y, 3);

  // Luci paddle (seguono paddle Y)
  lightLeft.position.y  = paddles.left;
  lightRight.position.y = paddles.right;

  // Animazione idle prima del gioco
  if (state.phase === 'idle' || state.phase === 'gameover') {
    const t = performance.now() * 0.001;
    meshPaddleL.position.y = Math.sin(t * 0.9) * 2;
    meshPaddleR.position.y = Math.sin(t * 0.9 + Math.PI) * 2;
    meshBall.position.set(Math.sin(t * 0.4) * 3, Math.sin(t * 0.7) * 2, 0);
    sprBallGlow.position.set(meshBall.position.x, meshBall.position.y, 0.2);
    lightBall.position.set(meshBall.position.x, meshBall.position.y, 3);
  }
}

// ─────────────────────────────────────────────
//  LOOP PRINCIPALE
// ─────────────────────────────────────────────
let lastTime = 0;

function animate(timestamp) {
  requestAnimationFrame(animate);
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  update(dt);
  updateTrail();
  syncMeshes(dt);
  applyCameraShake(dt);

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
