import { execSync } from 'child_process';

const id = process.argv[2];
if (!id) {
  console.log('Dùng: node scripts/relogin.mjs worker-01');
  process.exit(1);
}

console.log(`Login lại ví ${id}...`);
try {
  execSync(`docker compose stop ${id}`, { stdio: 'inherit' });
  execSync(`docker compose run --rm -it ${id} tempo wallet login`, { stdio: 'inherit' });
  console.log(`\n✅ Done. Chạy: docker compose up -d ${id}`);
} catch (e) {
  console.error('❌', e.message);
}
