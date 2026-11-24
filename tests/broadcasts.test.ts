import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEmbedUrl,streamWatchUrl,broadcastWatchUrl,matchBroadcasts,parseBroadcastLink,validateBroadcastLinks,updateBroadcastLinks,isWatchableLiveMatch,liveBroadcastFields,type BroadcastLink} from '../src/lib/streamUtils';
import type {BracketDraft,Match} from '../src/lib/types';
const yt='https://www.youtube.com/watch?v=0P41gTF-Nl4',fb='https://www.facebook.com/ArenaHub/videos/12345/',tt='https://www.tiktok.com/@arenahub/live';
test('new broadcasts require one embeddable link and an uploaded thumbnail', () => {
  const thumbnail = 'data:image/jpeg;base64,/9j/4AAQ';
  assert.throws(() => liveBroadcastFields(yt, ''), /Upload a thumbnail/);
  assert.throws(() => liveBroadcastFields(tt, thumbnail), /play in ArenaHub/);
  for (const [url, platform] of [[yt, 'youtube'], [fb, 'facebook']]) {
    const fields = liveBroadcastFields(url, thumbnail);
    assert.equal(fields.status, 'live');
    assert.deepEqual(fields.broadcastLinks, [{ platform, url }]);
    assert.deepEqual(fields.thumbnail, { source: 'custom', url: thumbnail });
    assert.match(fields.streamUrl, /(?:\/embed\/|\/plugins\/video)/);
  }
});
test('the original Facebook connection flow also drops access tokens before embedding',()=>{
  const embed=buildEmbedUrl(fb+'?access_token=PRIVATE&fbclid=TRACKER#secret','facebook')!;assert.ok(!embed.includes('PRIVATE'));assert.ok(!embed.includes('TRACKER'));assert.equal(streamWatchUrl(embed),fb);
  const watch=buildEmbedUrl('https://www.facebook.com/watch/?v=12345&access_token=PRIVATE','facebook')!;assert.equal(streamWatchUrl(watch),'https://www.facebook.com/watch/?v=12345');
});
test('public platform links normalize and strip private or tracking query parameters',()=>{
  assert.equal(broadcastWatchUrl(yt+'&token=PRIVATE','youtube'),yt);
  assert.equal(broadcastWatchUrl(fb+'?access_token=PRIVATE','facebook'),fb);
  assert.equal(broadcastWatchUrl(tt+'?share=abc','tiktok'),tt);
  for(const url of ['rtmp://server/private-key','javascript:alert(1)','https://www.tiktok.com.evil.test/@arenahub/live','https://user:secret@tiktok.com/@arenahub/live','https://tiktok.com/@arenahub','https://tiktok.com/@arenahub/video/123'])assert.equal(broadcastWatchUrl(url,'tiktok'),null);
});
test('multi-platform links can publish either an embedded player or an external primary',()=>{
  const links:BroadcastLink[]=[{platform:'youtube',url:yt},{platform:'facebook',url:fb},{platform:'tiktok',url:tt}];
  const result=validateBroadcastLinks(links,'facebook');assert.match(result.streamUrl!,/facebook.com\/plugins/);
  const view=matchBroadcasts(result);assert.equal(view[0].platform,'facebook');assert.equal(view.length,3);assert.equal(view.find(l=>l.platform==='tiktok')?.embedUrl,null);
  assert.deepEqual(validateBroadcastLinks([links[2]],'tiktok'), { broadcastLinks:[links[2]],streamUrl:undefined });
  const externalPrimary = validateBroadcastLinks(links,'tiktok');
  assert.equal(matchBroadcasts(externalPrimary)[0].platform,'tiktok');
  assert.throws(()=>validateBroadcastLinks([links[0],links[0]]),/once/);
  assert.throws(()=>validateBroadcastLinks([links[0]],'facebook'),/saved/);
  assert.equal(isWatchableLiveMatch({status:'live',broadcastLinks:[links[0]]}),true);
  assert.equal(isWatchableLiveMatch({status:'completed',broadcastLinks:links}),false);
  assert.equal(isWatchableLiveMatch({status:'live',broadcastLinks:[links[2]]}),true);
});
test('external-only watch links are published as links and reject credentials and local destinations', () => {
  const source = parseBroadcastLink('https://www.twitch.tv/arenahub?utm_source=tracking#ref');
  assert.deepEqual(source, { platform:'other', url:'https://www.twitch.tv/arenahub', embedUrl:null });
  const published = validateBroadcastLinks([source!], 'other');
  assert.equal(published.streamUrl, undefined);
  assert.equal(isWatchableLiveMatch({ status:'live', ...published }), true);
  for (const url of ['https://localhost/live', 'https://127.0.0.1/live', 'https://host.internal/live',
    'https://twitch.tv/live?stream_key=private', 'http://twitch.tv/arenahub',
    'https://username:password@twitch.tv/arenahub', 'https://tiktok.com/@arenahub', 'https://www.youtube.com/@arenahub']) {
    assert.equal(parseBroadcastLink(url), null, url);
  }
});
test('editing one feed preserves other simultaneous matches, scores and status',()=>{
  const a={id:'a',status:'live',score:{team1Score:1,team2Score:0},streamUrl:yt},b={id:'b',status:'live',streamUrl:fb};
  const brackets=[{id:'cup-a',matches:[a]},{id:'cup-b',matches:[b]}] as unknown as BracketDraft[];
  const updated=updateBroadcastLinks(brackets,'a',[{platform:'youtube',url:yt},{platform:'facebook',url:fb}],'facebook');
  assert.equal(updated[1].matches[0],b);assert.equal(updated[0].matches[0].status,'live');assert.deepEqual(updated[0].matches[0].score,a.score);assert.equal(a.streamUrl,yt);
  const cleared=updateBroadcastLinks(updated,'a',[]);assert.equal(cleared[0].matches[0].streamUrl,undefined);assert.deepEqual(cleared[0].matches[0].broadcastLinks,[]);assert.equal(cleared[0].matches[0].status,'live');
  assert.throws(()=>updateBroadcastLinks(brackets,'missing',[]),/unavailable/);
});
test('legacy primary wins within its platform and malformed stored links do not become players',()=>{
  const match={streamUrl:yt,broadcastLinks:[{platform:'youtube',url:'https://youtube.com/watch?v=abcdefghijk'},{platform:'tiktok',url:tt},null,{platform:'facebook',url:'https://evil.test/video'}]} as unknown as Match;
  const links=matchBroadcasts(match);assert.equal(links.length,2);assert.equal(links[0].url,yt);assert.equal(links[0].platform,'youtube');
});

test('match card thumbnail follows the organizer choice', async () => {
  const { matchThumbnails, safeThumbnailUrl } = await import('../src/lib/streamUtils');
  const yt = { status: 'live', streamUrl: 'https://www.youtube.com/embed/m4zQpYzzM0g?autoplay=1' };
  const art = '/games/mlbb.jpg';
  assert.equal(matchThumbnails(yt, art)[0], 'https://i.ytimg.com/vi/m4zQpYzzM0g/hqdefault.jpg');
  assert.deepEqual(matchThumbnails({ ...yt, thumbnail: { source: 'artwork' } }, art), [art]);
  const custom = 'https://firebasestorage.googleapis.com/v0/b/x/o/broadcastThumbnails%2Fm1%2Fa.jpg?alt=media';
  assert.equal(matchThumbnails({ ...yt, thumbnail: { source: 'custom', url: custom } }, art)[0], custom);
  // Anything that is not our storage or a plain image data URL is ignored and the card falls back.
  assert.equal(matchThumbnails({ ...yt, thumbnail: { source: 'custom', url: 'javascript:alert(1)' } }, art)[0], 'https://i.ytimg.com/vi/m4zQpYzzM0g/hqdefault.jpg');
  assert.equal(safeThumbnailUrl('https://evil.example/a.jpg'), null);
  assert.equal(safeThumbnailUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.ok(safeThumbnailUrl('data:image/jpeg;base64,/9j/4AAQ'));
});
