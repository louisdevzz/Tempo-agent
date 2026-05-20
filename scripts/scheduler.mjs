import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, '..');
const WORKER_ID = process.env.WORKER_ID || 'worker-01';

// ============ CẤU HÌNH — SỬA Ở ĐÂY ============

const WORKER_PROFILES = {
  'worker-01': { minInterval: 30, maxInterval: 120, startupDelay: 0 },
  'worker-02': { minInterval: 30, maxInterval: 120, startupDelay: [10, 25] },
  'worker-03': { minInterval: 30, maxInterval: 120, startupDelay: [5, 15] },
  'worker-04': { minInterval: 30, maxInterval: 120, startupDelay: [15, 30] },
  'worker-05': { minInterval: 30, maxInterval: 120, startupDelay: [10, 20] },
};

const WORKER_SCHEDULE = {
  'worker-01': { start: 8,  end: 17 },
  'worker-02': { start: 17, end: 3  },
  'worker-03': { start: 8,  end: 17 },
  'worker-04': { start: 17, end: 3  },
  'worker-05': { start: 9,  end: 21 },
};

const BALANCE_CHECK_EVERY = 5;
const BALANCE_WARN = 0.50;
const BALANCE_STOP = 0.30;
const MAX_RESULTS = 50;

// ============ HELPERS ============

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function log(msg) {
  const t = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Bangkok' });
  console.log(`[${t}] ${msg}`);
}

function getHour() {
  return parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false,
  }));
}

function isInSchedule(s) {
  const h = getHour();
  return s.start < s.end ? (h >= s.start && h < s.end) : (h >= s.start || h < s.end);
}

function minsUntilStart(s) {
  const h = getHour();
  const m = parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok', minute: 'numeric',
  }));
  let wait = s.start - h;
  if (wait <= 0) wait += 24;
  return wait * 60 - m;
}

// ============ RANDOMIZE PAYLOAD ============

function setNested(obj, path, val) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = isNaN(keys[i]) ? keys[i] : +keys[i];
    if (!cur[k]) cur[k] = {};
    cur = cur[k];
  }
  const last = isNaN(keys.at(-1)) ? keys.at(-1) : +keys.at(-1);
  cur[last] = val;
}

function randomizePayload(payload, randomize) {
  const r = JSON.parse(JSON.stringify(payload));
  if (!randomize) return r;
  for (const [path, vals] of Object.entries(randomize)) {
    if (Array.isArray(vals) && vals.length) setNested(r, path, pick(vals));
  }
  return r;
}

// ============ BALANCE ============

function checkBalance() {
  try {
    const out = execSync('tempo wallet -t balance', { timeout: 30000, encoding: 'utf8' }).trim();
    const m = out.match(/\$?([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

// ============ EXECUTE ============

function runTask(task, payload) {
  const { method, url } = task;
  let cmd;
  if (method.toUpperCase() === 'GET') {
    const qs = new URLSearchParams(payload).toString();
    cmd = `tempo request -t -X GET "${qs ? url + '?' + qs : url}"`;
  } else {
    const json = JSON.stringify(payload).replace(/'/g, "'\\''");
    cmd = `tempo request -t -X POST --json '${json}' "${url}"`;
  }
  try {
    const out = execSync(cmd, { timeout: 120000, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8' });
    return { success: true, response: out.slice(0, 1000) };
  } catch (e) {
    return { success: false, response: e.message.slice(0, 500) };
  }
}

// ============ FILE OPS ============

function ensureDir(d) { mkdirSync(d, { recursive: true }); }

function saveResult(dir, task, payload, result) {
  const f = `${task.id}-${Date.now()}.json`;
  writeFileSync(join(dir, f), JSON.stringify({
    timestamp: new Date().toISOString(),
    taskId: task.id, taskName: task.name, service: task.service,
    success: result.success, response: result.response,
  }, null, 2));
  const pDir = join(dir, '..', 'payloads');
  ensureDir(pDir);
  writeFileSync(join(pDir, f), JSON.stringify({ taskId: task.id, payload }, null, 2));
}

function cleanup(dir) {
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    if (files.length > MAX_RESULTS) {
      const del = files.slice(0, files.length - MAX_RESULTS);
      del.forEach(f => unlinkSync(join(dir, f)));
      log(`🧹 Dọn ${del.length} kết quả cũ`);
    }
  } catch {}
}

function saveAlert(dir, msg) {
  ensureDir(dir);
  writeFileSync(join(dir, `alert-${Date.now()}.txt`), `${new Date().toISOString()}\n${msg}\n`);
}

// ============ MAIN ============

async function main() {
  const profile = WORKER_PROFILES[WORKER_ID] || { minInterval: 30, maxInterval: 120, startupDelay: 0 };
  const schedule = WORKER_SCHEDULE[WORKER_ID] || { start: 8, end: 22 };

  const tasksFile = join(BASE_DIR, 'scripts', `tasks-${WORKER_ID}.json`);
  let tasks;
  try { tasks = JSON.parse(readFileSync(tasksFile, 'utf8')); }
  catch (e) { log(`❌ Không đọc được: ${tasksFile}\n   ${e.message}`); process.exit(1); }

  log(`🚀 Worker ${WORKER_ID} | ${tasks.length} tasks | ${schedule.start}h→${schedule.end}h | ${profile.minInterval}–${profile.maxInterval}min`);

  const rt = join(BASE_DIR, 'runtime', WORKER_ID);
  const dirs = { results: join(rt, 'results'), alerts: join(rt, 'alerts'), logs: join(rt, 'logs'), state: join(rt, 'state') };
  Object.values(dirs).forEach(ensureDir);

  let delay = profile.startupDelay;
  if (Array.isArray(delay)) delay = rand(delay[0], delay[1]);
  if (delay > 0) { log(`⏳ Startup delay: ${delay}min`); await sleep(delay * 60000); }

  const bal = checkBalance();
  if (bal !== null) log(`💰 Số dư: $${bal.toFixed(2)}`);

  let count = 0, errors = 0;

  while (true) {
    try {
      if (!isInSchedule(schedule)) {
        const w = minsUntilStart(schedule);
        log(`😴 Ngoài giờ. Ngủ ${w}min đến ${schedule.start}h...`);
        await sleep(w * 60000);
        continue;
      }

      if (count > 0 && count % BALANCE_CHECK_EVERY === 0) {
        const b = checkBalance();
        if (b !== null) {
          log(`💰 $${b.toFixed(2)} (${count} tasks)`);
          if (b < BALANCE_STOP) {
            const msg = `🛑 $${b.toFixed(2)} < $${BALANCE_STOP}. Tạm dừng 1h.`;
            log(msg); saveAlert(dirs.alerts, msg);
            await sleep(3600000); continue;
          }
          if (b < BALANCE_WARN) {
            const msg = `⚠️ Số dư thấp: $${b.toFixed(2)}`;
            log(msg); saveAlert(dirs.alerts, msg);
          }
        }
      }

      const task = pick(tasks);
      const payload = randomizePayload(task.payload, task.randomize);
      log(`\n🎯 Task: ${task.name} (${task.service})`);

      const result = runTask(task, payload);
      log(result.success ? '✅ OK' : `❌ FAIL: ${result.response.slice(0, 100)}`);
      result.success ? errors = 0 : errors++;

      saveResult(dirs.results, task, payload, result);
      count++;
      cleanup(dirs.results);

      writeFileSync(join(dirs.state, 'last-run.json'), JSON.stringify({
        lastRun: new Date().toISOString(), taskCount: count,
        lastTask: task.id, lastStatus: result.success ? 'OK' : 'FAIL',
      }, null, 2));

      const wait = rand(profile.minInterval, profile.maxInterval);
      log(`⏰ Chờ ${wait}min | Tasks: ${count} | Last: ${result.success ? 'OK' : 'FAIL'}`);
      await sleep(wait * 60000);

    } catch (e) {
      log(`❌ Lỗi: ${e.message}`);
      errors++;
      if (errors >= 10) { log('🛑 10 lỗi liên tiếp. Chờ 1h.'); await sleep(3600000); errors = 0; }
      else { log('⏰ Chờ 5min...'); await sleep(300000); }
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
