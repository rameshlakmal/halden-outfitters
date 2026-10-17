// npm run dev: the API (http://127.0.0.1:4000), the shop (http://localhost:3001) and the staff admin
// (http://localhost:3002) together, with prefixed output. Ctrl+C stops all three.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: 36, args: ['run', 'dev', '-w', '@halden/api'] },
  { name: 'web', color: 35, args: ['run', 'dev', '-w', '@halden/web'] },
  { name: 'adm', color: 33, args: ['run', 'dev', '-w', '@halden/admin'] },
].map(({ name, color, args }) => {
  const child = spawn('npm', args, { shell: true, env: process.env });
  const tag = `\x1b[${color}m${name.padEnd(3)}\x1b[0m |`;
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', (d) => {
      const lines = (rest + d).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const l of lines) console.log(tag, l);
    });
  }
  child.on('exit', (code) => {
    console.log(tag, `exited (${code})`);
    process.exit(code ?? 0);
  });
  return child;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill('SIGINT')));
