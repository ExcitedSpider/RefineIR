import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const svf = process.env.SVF_ROOT || resolve(root, '../SVF');
const llvm = process.env.LLVM_ROOT || `${svf}/llvm-21.1.0.obj`;
const z3 = process.env.Z3_ROOT || `${svf}/z3.obj`;
for (const [path, setting] of [
  [`${svf}/Release-build/lib/cmake/SVF/SVFConfig.cmake`, 'SVF_ROOT'],
  [`${llvm}/bin/clang`, 'LLVM_ROOT'],
  [`${llvm}/bin/opt`, 'LLVM_ROOT'],
  [`${z3}/include/z3++.h`, 'Z3_ROOT'],
  [`${z3}/bin/libz3.so`, 'Z3_ROOT'],
]) {
  if (!existsSync(path)) throw new Error(`Missing dependency: ${path}\nBuild the toolchain using the README, or set ${setting} to your existing installation.`);
}
function run(command, args, extra = {}, expectedExit = 0) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { cwd: root, ...extra });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => code === expectedExit ? resolve(out) : reject(new Error(`${command}: exit ${code}: ${err || out}`)));
  });
}
mkdirSync(`${root}/build`, { recursive: true });
mkdirSync(`${root}/site/dist/data`, { recursive: true });
await run('cmake', ['-S', '.', '-B', 'build', '-G', 'Ninja', `-DSVF_DIR=${svf}/Release-build/lib/cmake/SVF`, `-DLLVM_DIR=${llvm}/lib/cmake/llvm`, `-DZ3_INCLUDE_DIR=${z3}/include`, `-DZ3_LIBRARY_DIR=${z3}/bin/libz3.so`]);
await run('cmake', ['--build', 'build']);
const examples = [
  ['contradiction', 'The impossible branch', 'One missing fact creates a false alarm.', 'SAFE', 2],
  ['real-bug', 'A real counterexample', 'One changed condition turns the alarm into a bug.', 'UNSAFE', 1],
  ['arithmetic', 'Follow the arithmetic', 'An unsigned addition connects two branch conditions.', 'SAFE', 2],
  ['two-refinements', 'Learn one fact at a time', 'Two independent contradictions need two refinements.', 'SAFE', 3],
  ['relational', 'Remember a relation: x > y', 'Two symbolic inputs; one relational predicate rules out the false alarm.', 'SAFE', 2],
  ['unsupported-loop', 'Know the boundary', 'A loop is outside this first prototype.', 'UNKNOWN', 0],
];
const results = [];
for (const [id, title, subtitle, expected, rounds] of examples) {
  await run(`${llvm}/bin/clang`, ['-O0', '-g', '-fwrapv', '-fno-discard-value-names', '-Xclang', '-disable-O0-optnone', '-emit-llvm', '-c', `examples/${id}.c`, '-o', `build/${id}.raw.bc`]);
  await run(`${llvm}/bin/opt`, ['-passes=mem2reg', `build/${id}.raw.bc`, '-o', `build/${id}.bc`]);
  await run(`${llvm}/bin/llvm-dis`, [`build/${id}.bc`, '-o', `build/${id}.ll`]);
  await run(`${root}/build/svf-cegar`, [`build/${id}.bc`, `examples/${id}.c`, `site/dist/data/${id}.json`]);
  const data = JSON.parse(readFileSync(`${root}/site/dist/data/${id}.json`));
  const refinements=data.rounds.filter(r=>r.learnedPredicates?.length).length;
  console.log(`${id}: ${data.verdict}; ${data.rounds.length} rounds; ${refinements} refinements; ${data.reason}`);
  if (data.verdict !== expected || data.rounds.length !== rounds) throw new Error(`Unexpected result for ${id}`);
  Object.assign(data, { id, title, subtitle, llvm: readFileSync(`${root}/build/${id}.ll`, 'utf8') });
  if (data.verdict === 'UNSAFE') {
    await run(`${llvm}/bin/clang`, ['-O0', '-fwrapv', `examples/${id}.c`, 'scripts/replay.c', '-o', `build/replay-${id}`]);
    const env = { ...process.env };
    for (const [i, w] of data.rounds.at(-1).witness.entries()) env[`CEGAR_INPUT_${i}`] = String(w.unsigned);
    const output = await run(`${root}/build/replay-${id}`, [], { env }, 42);
    if (!output.includes('ERROR reached')) throw new Error('Witness did not replay');
    data.replay = { confirmed: true, exitCode: 42, stdout: output.trim() };
  }
  results.push(data);
  writeFileSync(`${root}/site/dist/data/${id}.json`, JSON.stringify(data, null, 2));
}
const commit = (await run('git', ['-C', svf, 'rev-parse', 'HEAD'])).trim();
const output = { generatedAt: new Date().toISOString(), svfCommit: commit, semantics: '32-bit inputs; bit-vector arithmetic; signed and unsigned comparisons; acyclic SSA without phi or memory', examples: results };
writeFileSync(`${root}/site/dist/data/results.json`, JSON.stringify(output, null, 2));
// A script bundle also works when index.html is opened directly from disk.
writeFileSync(`${root}/site/dist/data/results.js`, `window.CEGAR_RESULTS = ${JSON.stringify(output).replaceAll('<', '\\u003c')};\n`);
console.log(`Recorded ${results.length} real SVF/Z3 analyses at ${basename(root)}/site/dist.`);
