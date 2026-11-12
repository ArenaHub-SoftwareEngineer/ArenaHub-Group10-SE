import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocFromServer, onSnapshot } from 'firebase/firestore';

// All writes are isolated to the demo project's loopback emulator.
test('broadcast links propagate to a separate viewer, survive reload, replace and disconnect; viewers cannot write', async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-arenahub', firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').at(-1)) || 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  const team = (id, name) => ({ id, name, collegeCode: 'QA', collegeId: 'qa', seed: 1, gameId: 'game-mlbb', players: [], winRate: 0, record: '0-0' });
  const match = { id: 'qa-stream-1', matchNumber: 'QA-STREAM-1', tournamentId: 'qa-stream-cup', gameId: 'game-mlbb', round: 1, roundName: 'Final', status: 'upcoming', matchFormat: 'Bo3', team1: team('qa-a', 'Broadcast Test A'), team2: team('qa-b', 'Broadcast Test B'), score: { team1Score: 0, team2Score: 0 }, scheduledTime: '14:00', scheduledDate: '2026-11-02' };
  const bracket = { id: 'qa-stream-cup', title: 'Disposable Broadcast QA', gameName: 'Mobile Legends: Bang Bang', format: 'Single Elimination', teamsCount: 2, matchFormat: 'Bo3', seedingRule: 'Seed', matches: [match], teams: [{name:'Broadcast Test A'},{name:'Broadcast Test B'}], parsedParams: {game:'MLBB',format:'Single Elimination',seeding:'Seed',constraint:'None',teamsCount:2,matchFormat:'Bo3'}, rawPrompt:'Disposable local broadcast testing',createdAt:new Date().toISOString(),status:'published' };
  const payload = () => ({ publishedBrackets: [bracket], savedBracketDraft: null, updatedAt: new Date().toISOString() });
  const staff = env.authenticatedContext('stream-staff', {admin:true,email_verified:true,email:"staff@wmsu.edu.ph"}).firestore();
  const viewer = env.authenticatedContext('stream-viewer', {email_verified:true,email:"viewer@wmsu.edu.ph"}).firestore();
  const ref = database => doc(database, 'arenahub', 'brackets');
  const waitFor = predicate => {
    let stop;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop?.(); reject(new Error('Viewer did not receive the broadcast update in 10 seconds')); },10000);
      stop = onSnapshot(ref(viewer), snapshot => {
        if (snapshot.exists() && predicate(snapshot.data().publishedBrackets[0]?.matches[0])) {clearTimeout(timer);stop?.();resolve(snapshot.data());}
      },error=>{clearTimeout(timer);reject(error);});
    });
    return promise;
  };
  try {
    await env.withSecurityRulesDisabled(async ctx => {
      for (const uid of ['stream-staff','stream-viewer','stream-reloaded']) await setDoc(doc(ctx.firestore(),'users',uid),{uid,status:'active',emailVerified:true,role:'user'});
    });
    await setDoc(ref(staff),payload());
    const youtube = 'https://www.youtube.com/embed/0P41gTF-Nl4?autoplay=1&mute=1&playsinline=1&rel=0';
    let received = waitFor(m => m?.streamUrl === youtube && m?.status === 'live');
    match.streamUrl = youtube; match.status = 'live';
    await setDoc(ref(staff),payload()); await received;
    const reloaded = env.authenticatedContext('stream-reloaded',{email_verified:true,email:"viewer@wmsu.edu.ph"}).firestore();
    assert.equal((await getDocFromServer(ref(reloaded))).data().publishedBrackets[0].matches[0].streamUrl,youtube);
    await assertFails(setDoc(ref(viewer),payload()));
    const facebook = 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2FFacebookDevelopers%2Fvideos%2F10152454700553553%2F&show_text=false&autoplay=true&allowFullScreen=true';
    received = waitFor(m => m?.streamUrl === facebook);
    match.streamUrl = facebook; await setDoc(ref(staff),payload()); await received;
    received = waitFor(m => m && !m.streamUrl);
    delete match.streamUrl; await setDoc(ref(staff),payload()); await received;
    assert.equal((await getDocFromServer(ref(reloaded))).data().publishedBrackets[0].matches[0].streamUrl,undefined);
    // Leave a labelled, disconnected fixture for the organizer/viewer browser checks.
  } finally { await env.cleanup(); }
});
