import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const env = readFileSync('.env', 'utf8')
  .split('\n')
  .map((line) => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1)];
  });
const values = env
  .filter(([k, v]) => /(SECRET|PASSWORD|ENCRYPTION_KEY)$/.test(k) && v.length >= 20)
  .map(([, v]) => v);
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const bad = files.filter(
  (file) =>
    file === '.env' ||
    (!/\.(png|webm|jpg)$/.test(file) &&
      values.some((value) => readFileSync(file, 'utf8').includes(value))),
);
if (bad.length) {
  console.error('Revisar secretos en: ' + bad.join(', '));
  process.exit(1);
}
console.log(
  `Archivos Git revisados: ${files.length}. No contienen los secretos locales generados.`,
);
