import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Deploy only our directory. Never reuse or reset the user's hosting checkout.
const siteDirectory = 'marketingreview';
const siteUrl = `https://cfireborn.github.io/${siteDirectory}/`;
const sourceUrl = 'https://github.com/cfireborn/promptArmorTakeHome';
const hostingRemote = 'git@github.com:cfireborn/cfireborn.github.io.git';
const [distArgument, sourceSha, option] = process.argv.slice(2);

if (!distArgument || !/^[a-f0-9]{40}$/.test(sourceSha ?? '') || (option && option !== '--dry-run') || process.argv.length > 5) {
  console.error('Usage: node scripts/deploy.mjs <dist-directory> <full-source-commit-sha> [--dry-run]');
  process.exit(1);
}

const dist = resolve(distArgument);
if (!existsSync(join(dist, 'index.html'))) throw new Error('Build output is missing index.html. Run npm run build first.');

function checkFiles(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Deployment cannot include symlinks: ${path}`);
    if (stat.isDirectory()) checkFiles(path);
    else if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error(`Unsupported or oversized deployment file: ${path}`);
  }
}
checkFiles(dist);

const temporaryRoot = mkdtempSync(join(tmpdir(), 'clearpath-deploy-'));
const checkout = join(temporaryRoot, 'hosting');
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

try {
  execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', 'master', hostingRemote, checkout], { stdio: 'inherit' });
  git('sparse-checkout', 'set', siteDirectory);
  git('checkout', 'master');
  const destination = join(checkout, siteDirectory);
  rmSync(destination, { recursive: true, force: true });
  cpSync(dist, destination, { recursive: true });
  writeFileSync(join(destination, 'release.json'), `${JSON.stringify({ source: sourceUrl, commit: sourceSha })}\n`);
  git('add', '--', siteDirectory);

  const paths = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  if (paths.some(path => !path.startsWith(`${siteDirectory}/`))) throw new Error('Refusing to change files outside the deployment directory.');
  if (!paths.length) {
    console.log(`No changes to deploy. ${siteUrl}`);
    rmSync(temporaryRoot, { recursive: true, force: true });
    process.exit(0);
  }
  console.log(git('diff', '--cached', '--stat'));
  if (option === '--dry-run') {
    console.log(`Prepared only; nothing committed or pushed. Inspect ${checkout}`);
  } else {
    git('commit', '-m', `Deploy ClearPath Relay ${sourceSha.slice(0, 12)}`);
    git('push', 'origin', 'HEAD:master');
    console.log(`Published hosting commit ${git('rev-parse', 'HEAD')}. GitHub Pages will deploy ${siteUrl}`);
    console.log(`Verify ${siteUrl}release.json and the hosting Actions run before claiming deployment is live.`);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
} catch (error) {
  console.error(`Deployment stopped. Temporary checkout retained at ${checkout}.`);
  console.error('If another hosting commit landed, rerun from a fresh clone; never force-push.');
  throw error;
}
