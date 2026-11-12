import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocFromServer, onSnapshot, serverTimestamp } from 'firebase/firestore';

// All writes are isolated to the demo project's loopback emulator.
test('broadcast links propagate to a separate viewer, survive reload, replace and disconnect; viewers cannot write', async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-arenahub', firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').at(-1)) || 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  const team = (id, name) => ({ id, name, collegeCode: 'QA', collegeId: 'qa', seed: 1, gameId: 'game-mlbb' });
  const match = { id: 'qa-stream-1', matchNumber: 'QA-STREAM-1', tournamentId: 'qa-stream-cup', gameId: 'game-mlbb', round: 1, roundName: 'Final', bracketType: 'final', status: 'upcoming', matchFormat: 'Bo3', team1: team('qa-a', 'Broadcast Test A'), team2: team('qa-b', 'Broadcast Test B'), score: { team1Score: 0, team2Score: 0 }, scheduledDate: 'QA', scheduledTime: 'QA', organizerName: 'QA' };
  let revision = 0;
  const tournament = () => ({ id: 'qa-stream-cup', title: 'Disposable Broadcast QA', gameId: 'game-mlbb', gameName: 'Mobile Legends: Bang Bang', gameKey: 'game-mlbb', format: 'Single Elimination', matchFormat: 'Bo3', teamsCount: 2, seedingRule: 'Seed', createdAt: 'QA', status: 'published', revision: ++revision, featured: false, matches: [JSON.parse(JSON.stringify(match))], updatedAt: serverTimestamp() });
  const staff = env.authenticatedContext('stream-staff', { admin: true, email_verified: true, email: 'staff@wmsu.edu.ph' }).firestore();
  const viewer = env.authenticatedContext('stream-viewer', { email_verified: true, email: 'viewer@wmsu.edu.ph' }).firestore();
  const ref = database => doc(database, 'tournaments', 'qa-stream-cup');
  const waitFor = predicate => {
    let stop;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop?.(); reject(new Error('Viewer did not receive the broadcast update in 10 seconds')); }, 10000);
      stop = onSnapshot(ref(viewer), snapshot => {
        if (snapshot.exists() && predicate(snapshot.data().matches[0])) { clearTimeout(timer); stop?.(); resolve(snapshot.data()); }
      }, error => { clearTimeout(timer); reject(error); });
    });
  };
  try {
    await env.withSecurityRulesDisabled(async ctx => {
      for (const uid of ['stream-staff', 'stream-viewer', 'stream-reloaded']) await setDoc(doc(ctx.firestore(), 'users', uid), { uid, status: 'active', emailVerified: true, role: 'user' });
      // Start from a clean revision so reruns against a long-lived emulator still pass.
      await setDoc(doc(ctx.firestore(), 'tournaments', 'qa-stream-cup'), { ...tournament(), updatedAt: new Date() });
    });
    const youtube = 'https://www.youtube.com/embed/0P41gTF-Nl4?autoplay=1&mute=1&playsinline=1&rel=0';
    let received = waitFor(m => m?.streamUrl === youtube && m?.status === 'live');
    match.streamUrl = youtube; match.status = 'live';
    await setDoc(ref(staff), tournament()); await received;
    const reloaded = env.authenticatedContext('stream-reloaded', { email_verified: true, email: 'viewer@wmsu.edu.ph' }).firestore();
    assert.equal((await getDocFromServer(ref(reloaded))).data().matches[0].streamUrl, youtube);
    await assertFails(setDoc(ref(viewer), { ...tournament() }));
    revision--; // the rejected viewer write did not consume a revision
    const facebook = 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2FFacebookDevelopers%2Fvideos%2F10152454700553553%2F&show_text=false&autoplay=true&allowFullScreen=true';
    received = waitFor(m => m?.streamUrl === facebook);
    match.streamUrl = facebook; await setDoc(ref(staff), tournament()); await received;
    received = waitFor(m => m && !m.streamUrl);
    delete match.streamUrl; await setDoc(ref(staff), tournament()); await received;
    assert.equal((await getDocFromServer(ref(reloaded))).data().matches[0].streamUrl, undefined);
    // A stale write (same revision twice) is refused, so concurrent editors cannot overwrite each other.
    revision--;
    await assertFails(setDoc(ref(staff), tournament()));
  } finally { await env.cleanup(); }
});
