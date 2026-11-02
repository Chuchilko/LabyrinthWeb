import * as THREE from 'three';

/* НАСТРОЙКИ (живые, меняются ползунками) */
const settings = {
  speed: 3.0,
  friction: 0.15,
  tiltSpeed: 6.0,
  maxTilt: 14,
  ballRadius: 0.22,
};

/* ПАРАМЕТРЫ ЛАБИРИНТА */
const GRID = 15;
const CELL = 1.0;
const HALF = (GRID * CELL) / 2;
const WALL_H = 1.1;       // высота стен (удвоена)
const BORDER_W = 4.0;     // толщина внешнего обода, уходящего за экран

let maze = [];

/* THREE.JS: рендерер, сцена, камера */
const host = document.getElementById('scene-host');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x10131a, 1);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camSize = 8.2;
function makeCamera() {
  const aspect = host.clientWidth / host.clientHeight || 1;
  const h = camSize;
  const w = camSize * aspect;
    const cam = new THREE.OrthographicCamera(-w, w, h, -h, 0.1, 100);
  // Строго сверху, вертикально вниз, без перспективы
  cam.position.set(0, 12, 0);
  // up нельзя быть коллинеарным направлению взгляда; задаём ось "вверх экрана"
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  return cam;
}
let camera = makeCamera();

const ambient = new THREE.AmbientLight(0xffffff, 1.15);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(4, 10, 6);
scene.add(dirLight);

const world = new THREE.Group();
scene.add(world);

let floorMesh = null;
let wallGroup = null;
let ballMesh = null;
const startPos = new THREE.Vector3();
const finishPos = new THREE.Vector3();

/* =============== ГЕНЕРАЦИЯ ЛАБИРИНТА 15x15 ===============
   Простой DFS-лабиринт на нечётной сетке. true = стена. */
function generateMaze(n) {
  // все стены
  const m = Array.from({ length: n }, () => Array(n).fill(true));
  const inb = (x, y) => x > 0 && y > 0 && x < n - 1 && y < n - 1;

  function carve(x, y) {
    m[y][x] = false;
    const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    // перемешаем
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (inb(nx, ny) && m[ny][nx]) {
        m[y + dy / 2][x + dx / 2] = false;
        carve(nx, ny);
      }
    }
  }
  carve(1, 1);

  // гарантируем симметричные рамки и старт/финиш
  m[1][1] = false;
  m[n - 2][n - 2] = false;
  return m;
}

/* =============== ПОСТРОЕНИЕ 3D =============== */
function buildLevel() {
  maze = generateMaze(GRID);

  // очистка предыдущего
  while (world.children.length) world.remove(world.children[0]);

  // пол
  const floorGeo = new THREE.BoxGeometry(GRID * CELL, 0.2, GRID * CELL);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1d2735, roughness: 0.9, metalness: 0.0 });
  floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.y = -0.1;
  world.add(floorMesh);

  // стены — один общий материал/геометрия
  wallGroup = new THREE.Group();
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.7 });
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!maze[y][x]) continue;
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(
        x * CELL - HALF + CELL / 2,
        WALL_H / 2,
        y * CELL - HALF + CELL / 2
      );
      wallGroup.add(wall);
    }
  }
  world.add(wallGroup);

  // Внешний обод-рамка (высокая, уходит далеко за экран),
  // чтобы по краям не было видно тонких стенок при наклоне.
  const borderGroup = new THREE.Group();
  const borderMat = new THREE.MeshStandardMaterial({ color: 0x2b3850, roughness: 0.85 });
  const span = GRID * CELL + BORDER_W * 2; // общая длина стороны
  // верх/низ (вдоль X)
  for (const zSign of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(span, WALL_H * 2.2, BORDER_W), borderMat);
    b.position.set(0, (WALL_H * 2.2) / 2, zSign * (HALF + BORDER_W / 2));
    borderGroup.add(b);
  }
  // лево/право (вдоль Z)
  for (const xSign of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(BORDER_W, WALL_H * 2.2, span), borderMat);
    b.position.set(xSign * (HALF + BORDER_W / 2), (WALL_H * 2.2) / 2, 0);
    borderGroup.add(b);
  }
  world.add(borderGroup);

  // старт и финиш (центр клеток)
  startPos.set(1 * CELL - HALF + CELL / 2, settings.ballRadius, 1 * CELL - HALF + CELL / 2);
  finishPos.set((GRID - 2) * CELL - HALF + CELL / 2, 0.01, (GRID - 2) * CELL - HALF + CELL / 2);

  // метка финиша
  const finGeo = new THREE.CylinderGeometry(CELL * 0.32, CELL * 0.32, 0.05, 24);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x35ff9e, emissive: 0x0a5c34, emissiveIntensity: 0.8 });
  const fin = new THREE.Mesh(finGeo, finMat);
  fin.position.set(finishPos.x, 0.03, finishPos.z);
  world.add(fin);

    // шарик
  if (!ballMesh) {
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffcf4d, roughness: 0.35, metalness: 0.1 });
    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), ballMat);
    world.add(ballMesh);
  }
  updateBallSize();
  ballMesh.position.copy(startPos);

  // сброс физики
  ball.vel.set(0, 0);
  ball.pos.set(startPos.x, startPos.z);
}

/* Подгонка шарика под текущий размер (радиус масштабом) */
function updateBallSize() {
  if (!ballMesh) return;
  ballMesh.scale.setScalar(settings.ballRadius);
  ballMesh.position.y = settings.ballRadius;
}

/* ============================================================
   СОСТОЯНИЕ ИГРЫ (заготовка под бонусы, очки, таймер)
   Сейчас не активно, но сюда будем добавлять логику.
   ============================================================ */
const gameState = {
  running: false,
  score: 0,
  timeElapsed: 0,     // секунды
  bonuses: [],        // массив бонусов { mesh, pos: Vector2, radius, collected }
  levelComplete: false,
};

// Заготовки хуков — наполним в следующих итерациях
function startTimerIfNeeded() { /* TODO: запуск таймера при первом движении */ }
function updateBonuses(_dt) { /* TODO: сбор бонусов, проверка коллизий */ }
function checkLevelComplete() { /* TODO: проверка достижения финиша */ }

/* =============== ФИЗИКА ШАРИКА ===============
   Шарик живёт в плоскости лабиринта: pos = (x, z), vel = (vx, vz).
   Гравитация в плоскости зависит от наклона лабиринта. */
const ball = {
  pos: new THREE.Vector2(),
  vel: new THREE.Vector2(),
};

// текущий наклон лабиринта (в радианах), сглаженно тянется к целевому
const tilt = { x: 0, z: 0 };      // наклон вокруг осей X и Z
const tiltTarget = { x: 0, z: 0 }; // куда хотим наклонить (из ввода)

const GRAVITY = 9.8;

/* Столкновение шарика с сеточными стенами (AABB) и рамкой */
function collideWalls() {
  const r = settings.ballRadius;
  const p = ball.pos;
  const v = ball.vel;

  // интегрируем позицию сначала (двигаем)
  // проверяем клетку вокруг шарика
  const minGX = Math.floor((p.x - r + HALF) / CELL) - 1;
  const maxGX = Math.floor((p.x + r + HALF) / CELL) + 1;
  const minGY = Math.floor((p.y - r + HALF) / CELL) - 1;
  const maxGY = Math.floor((p.y + r + HALF) / CELL) + 1;

  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const isWall =
        gx < 0 || gy < 0 || gx >= GRID || gy >= GRID
          ? true
          : maze[gy]?.[gx];
      if (!isWall) continue;

      // AABB стены в мировых координатах
      const wx = gx * CELL - HALF;
      const wz = gy * CELL - HALF;
      const minX = wx, maxX = wx + CELL;
      const minZ = wz, maxZ = wz + CELL;

      // ближайшая точка бокса к центру шарика
      const cx = Math.max(minX, Math.min(p.x, maxX));
      const cz = Math.max(minZ, Math.min(p.y, maxZ));
      let dx = p.x - cx;
      let dz = p.y - cz;
      let dist2 = dx * dx + dz * dz;

      if (dist2 < r * r) {
        let dist = Math.sqrt(dist2) || 0.0001;
        // нормаль столкновения
        let nx = dx / dist;
        let nz = dz / dist;

        // если центр внутри бокса — выталкиваем по кратчайшей оси
        if (dist2 === 0) {
          const left = Math.abs(p.x - minX);
          const right = Math.abs(maxX - p.x);
          const top = Math.abs(p.y - minZ);
          const bottom = Math.abs(maxZ - p.y);
          const m = Math.min(left, right, top, bottom);
          if (m === left) { nx = -1; nz = 0; }
          else if (m === right) { nx = 1; nz = 0; }
          else if (m === top) { nx = 0; nz = -1; }
          else { nx = 0; nz = 1; }
          dist = 0;
        }

        // выталкиваем шарик из стены
        const penetration = r - dist;
        p.x += nx * penetration;
        p.y += nz * penetration;

        // отражаем скорость вдоль нормали с потерей энергии (отскок)
        const vn = v.x * nx + v.y * nz;
        if (vn < 0) {
          const restitution = 0.35; // упругость стен
          v.x -= (1 + restitution) * vn * nx;
          v.y -= (1 + restitution) * vn * nz;
        }
      }
    }
  }
}

/* Шаг физики */
function stepPhysics(dt) {
  // наклон тянется к целевому
  tilt.x += (tiltTarget.x - tilt.x) * Math.min(1, settings.tiltSpeed * dt);
  tilt.z += (tiltTarget.z - tilt.z) * Math.min(1, settings.tiltSpeed * dt);

  // ускорение от гравитации в плоскости лабиринта
  // наклон вокруг Z -> катит по X; наклон вокруг X -> катит по Z
  const ax = -Math.sin(tilt.z) * GRAVITY;
  const az = Math.sin(tilt.x) * GRAVITY;

  ball.vel.x += ax * dt * settings.speed;
  ball.vel.y += az * dt * settings.speed;

  // сопротивление (трение): гасим скорость
  const damp = Math.max(0, 1 - settings.friction * dt * 3);
  ball.vel.multiplyScalar(damp);

  // интегрируем позицию
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;

    collideWalls();

  // наклоняем группу лабиринта (после того как tilt догнал цель)
  world.rotation.z = tilt.z;
  world.rotation.x = tilt.x;

  // отображаем
  if (ballMesh) ballMesh.position.set(ball.pos.x, settings.ballRadius, ball.pos.y);
}

/* =============== ВВОД: ДЖОЙСТИК =============== */
const input = { x: 0, z: 0 }; // -1..1 по осям
const joystick = document.getElementById('joystick');
const knob = document.getElementById('joystick-knob');
const JOY_RADIUS = 41; // max смещение кнобa (px)

let joyActive = false;
let joyId = null;

function joyStart(e) {
  const t = e.changedTouches ? e.changedTouches[0] : e;
  joyActive = true;
  joyId = e.changedTouches ? t.identifier : null;
  joyMove(e);
}
function joyMove(e) {
  if (!joyActive) return;
  let t = e;
  if (e.changedTouches) {
    const found = Array.from(e.changedTouches).find((c) => c.identifier === joyId);
    if (!found) return;
    t = found;
  }
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = t.clientX - cx;
  let dy = t.clientY - cy;
  const len = Math.hypot(dx, dy);
  if (len > JOY_RADIUS) {
    dx = (dx / len) * JOY_RADIUS;
    dy = (dy / len) * JOY_RADIUS;
  }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  // нормализованный ввод
  input.x = dx / JOY_RADIUS;
  input.z = dy / JOY_RADIUS;
}
function joyEnd() {
  joyActive = false;
  joyId = null;
  knob.style.transform = 'translate(0,0)';
  input.x = 0;
  input.z = 0;
}

joystick.addEventListener('touchstart', (e) => { e.preventDefault(); joyStart(e); }, { passive: false });
joystick.addEventListener('touchmove', (e) => { e.preventDefault(); joyMove(e); }, { passive: false });
joystick.addEventListener('touchend', (e) => { e.preventDefault(); joyEnd(); }, { passive: false });
joystick.addEventListener('touchcancel', (e) => { e.preventDefault(); joyEnd(); }, { passive: false });

// мышь (для теста в браузере на компе)
joystick.addEventListener('mousedown', (e) => { e.preventDefault(); joyStart(e); });
window.addEventListener('mousemove', joyMove);
window.addEventListener('mouseup', joyEnd);

/* =============== ВВОД: ГИРОСКОП =============== */
const btnGyro = document.getElementById('btn-gyro');
let gyroOn = false;
let gyroBase = null;   // калибровочное смещение
let gyroTilt = { x: 0, z: 0 };

function onOrientation(e) {
  if (!gyroOn) return;
  // beta = наклон вперёд/назад (вокруг X), gamma = влево/вправо (вокруг Y)
  const beta = (e.beta ?? 0) * Math.PI / 180;
  const gamma = (e.gamma ?? 0) * Math.PI / 180;
    if (gyroBase === null) gyroBase = { beta, gamma };
  // отклонение от нуля (калибровка). Знаки инвертированы,
  // чтобы соответствовать управлению джойстиком.
  gyroTilt.x = (beta - gyroBase.beta);
  gyroTilt.z = -(gamma - gyroBase.gamma);
}

async function enableGyro() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        alert('Доступ к гироскопу не разрешён');
        return false;
      }
    }
    window.addEventListener('deviceorientation', onOrientation, true);
    gyroOn = true;
    gyroBase = null;
    btnGyro.textContent = 'Гироскоп: вкл';
    return true;
  } catch (err) {
    alert('Гироскоп недоступен на этом устройстве');
    return false;
  }
}

function disableGyro() {
  gyroOn = false;
  window.removeEventListener('deviceorientation', onOrientation, true);
  gyroTilt = { x: 0, z: 0 };
  btnGyro.textContent = 'Гироскоп: выкл';
}

btnGyro.addEventListener('click', () => {
  if (gyroOn) disableGyro();
  else enableGyro();
});

/* =============== ВВОД -> НАКЛОН ЛАБИРИНТА =============== */
const MAX_TILT_RAD = () => settings.maxTilt * Math.PI / 180;

function updateTiltTarget() {
  // Приоритет: если включён гироскоп и есть данные — берём его,
  // иначе — джойстик.
    if (gyroOn) {
    tiltTarget.z = THREE.MathUtils.clamp(gyroTilt.z, -MAX_TILT_RAD(), MAX_TILT_RAD());
    tiltTarget.x = THREE.MathUtils.clamp(gyroTilt.x, -MAX_TILT_RAD(), MAX_TILT_RAD());
  } else {
    // input.x — вправо (+), input.z — вниз (+)
    tiltTarget.z = -input.x * MAX_TILT_RAD();
    tiltTarget.x = input.z * MAX_TILT_RAD();
  }
}

/* =============== ПАНЕЛЬ НАСТРОЕК =============== */
const panel = document.getElementById('settings');
document.getElementById('btn-settings').addEventListener('click', () => panel.classList.remove('hidden'));
document.getElementById('btn-settings-close').addEventListener('click', () => panel.classList.add('hidden'));

const slSpeed = document.getElementById('set-speed');
const slFriction = document.getElementById('set-friction');
const slTiltSpeed = document.getElementById('set-tilt-speed');
const slMaxTilt = document.getElementById('set-max-tilt');
const slBallSize = document.getElementById('set-ball-size');

function syncSettingsUI() {
  document.getElementById('val-speed').textContent = settings.speed.toFixed(2);
  document.getElementById('val-friction').textContent = settings.friction.toFixed(2);
  document.getElementById('val-tilt-speed').textContent = settings.tiltSpeed.toFixed(1);
  document.getElementById('val-max-tilt').textContent = settings.maxTilt.toFixed(0) + '°';
  document.getElementById('val-ball-size').textContent = settings.ballRadius.toFixed(2);
}
slSpeed.addEventListener('input', () => { settings.speed = parseFloat(slSpeed.value); syncSettingsUI(); });
slFriction.addEventListener('input', () => { settings.friction = parseFloat(slFriction.value); syncSettingsUI(); });
slTiltSpeed.addEventListener('input', () => { settings.tiltSpeed = parseFloat(slTiltSpeed.value); syncSettingsUI(); });
slMaxTilt.addEventListener('input', () => { settings.maxTilt = parseFloat(slMaxTilt.value); syncSettingsUI(); });
slBallSize.addEventListener('input', () => { settings.ballRadius = parseFloat(slBallSize.value); updateBallSize(); syncSettingsUI(); });

/* =============== РЕСАЙЗ =============== */
function onResize() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h || 1;
  camera.left = -camSize * aspect;
  camera.right = camSize * aspect;
  camera.top = camSize;
  camera.bottom = -camSize;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

/* =============== ГЛАВНЫЙ ЦИКЛ =============== */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

    updateTiltTarget();
  stepPhysics(dt);

  // заготовки под будущую логику (пока пусто)
  if (gameState.running) gameState.timeElapsed += dt;
  updateBonuses(dt);
  checkLevelComplete();

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* =============== СТАРТ =============== */
function boot() {
  buildLevel();
  onResize();
  syncSettingsUI();

  // Telegram: развернуть на весь экран
  if (window.Telegram?.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
  }

  requestAnimationFrame(loop);
}

boot();




