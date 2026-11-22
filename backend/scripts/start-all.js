// Runs the API and the background worker in one process tree so the
// free Render web-service tier can host both. If either process dies,
// the launcher exits so the platform restarts both together.
const { spawn } = require('child_process');

const children = [];
let shuttingDown = false;

function start(name, args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[start-all] ${name} exited with code ${code ?? 'signal'} — stopping both so the platform restarts them.`);
    for (const other of children) other.kill('SIGTERM');
    process.exit(code ?? 1);
  });
  children.push(child);
}

start('api', ['dist/index.js']);
start('worker', ['dist/worker.js']);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shuttingDown = true;
    for (const child of children) child.kill(signal);
  });
}
