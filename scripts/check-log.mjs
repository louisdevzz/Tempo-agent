import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..');
const target = process.argv[2] || 'worker-01';

function show(id) {
  const dir = join(BASE, 'runtime', id, 'results');
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 10); }
  catch { console.log('  (chưa có kết quả)'); return; }
  if (!files.length) { console.log('  (chưa có kết quả)'); return; }
  let ok = 0, fail = 0;
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      d.success ? ok++ : fail++;
      const t = new Date(d.timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' });
      console.log(`  ${d.taskId} | ${d.success ? '✅' : '❌'} | ${t}`);
    } catch { console.log(`  ${f} (lỗi đọc)`); }
  }
  console.log(`  --- ${ok}/${ok + fail} thành công ---`);
  try {
    const s = JSON.parse(readFileSync(join(BASE, 'runtime', id, 'state', 'last-run.json'), 'utf8'));
    console.log(`  Tổng: ${s.taskCount} tasks | Last: ${s.lastStatus} | ${s.lastRun}`);
  } catch {}
}

if (target === 'all') {
  try {
    const ws = readdirSync(join(BASE, 'runtime')).filter(d => d.startsWith('worker-')).sort();
    ws.forEach(w => { console.log(`\n=== ${w} ===`); show(w); });
  } catch { console.log('Chưa có runtime data.'); }
} else { console.log(`\n=== ${target} ===`); show(target); }
