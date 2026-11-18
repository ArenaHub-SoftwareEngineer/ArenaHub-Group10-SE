// Builds the Android companion into dist-agent/arenahub-companion.apk without Android Studio.
// Needs the build tools in %LOCALAPPDATA%: ArenaHubBuild/jdk17, ArenaHubBuild/gradle-8.10.2 and
// Android/Sdk (platform 35, build-tools 34). See companion/android/README.md for how to get them.
//
// The project is copied to a plain-ASCII folder first: the Android build tools fail on Windows
// when the project path contains non-ASCII characters, and this repo's folder has an em dash.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const local = process.env.LOCALAPPDATA;
if (process.platform !== 'win32' || !local) { console.error('This script is written for the Windows event laptop.'); process.exit(1); }
const slash = path => path.split('\\').join('/');
const tools = join(local, 'ArenaHubBuild'), jdk = join(tools, 'jdk17'), gradle = join(tools, 'gradle-8.10.2', 'bin', 'gradle.bat'), sdk = join(local, 'Android', 'Sdk');
for (const [name, path] of [['JDK 17', jdk], ['Gradle 8.10.2', gradle], ['Android SDK', join(sdk, 'platforms', 'android-35')]]) {
  if (!existsSync(path)) { console.error(`${name} was not found at ${path}. See companion/android/README.md.`); process.exit(1); }
}

const SKIP = new Set(['build', '.gradle', '.idea', 'local.properties']);
function copy(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (SKIP.has(name)) continue;
    const source = join(from, name), target = join(to, name);
    if (statSync(source).isDirectory()) copy(source, target); else copyFileSync(source, target);
  }
}
const work = join(tools, 'companion');
copy(resolve('companion', 'android'), work);
writeFileSync(join(work, 'local.properties'), `sdk.dir=${slash(sdk)}\n`);

const lan = process.env.ARENAHUB_ALLOW_HTTP_LAN === '1';
const tasks = process.argv.includes('--verify') ? 'testDebugUnitTest lintDebug assembleDebug' : 'assembleDebug';
const run = spawnSync(`"${gradle}" --no-daemon -q -PallowLanHttp=${lan} ${tasks}`, { cwd: work, stdio: 'inherit', shell: true, env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk } });
if (run.status !== 0) { console.error('The Android build failed. The messages above say why.'); process.exit(1); }
const apk = join(work, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
mkdirSync(resolve('dist-agent'), { recursive: true });
copyFileSync(apk, resolve('dist-agent', 'arenahub-companion.apk'));
console.log(`Built ${resolve('dist-agent', 'arenahub-companion.apk')} (${(statSync(apk).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(lan ? 'LAN TEST BUILD: local HTTP enabled. Do not distribute as the public release.' : 'HTTPS-only companion build.');
