import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEmbedUrl,streamWatchUrl,broadcastWatchUrl,matchBroadcasts,validateBroadcastLinks,updateBroadcastLinks,isWatchableLiveMatch,type BroadcastLink} from '../src/lib/streamUtils';
import type {BracketDraft,Match} from '../src/lib/types';
const yt='https://www.youtube.com/watch?v=0P41gTF-Nl4',fb='https://www.facebook.com/ArenaHub/videos/12345/',tt='https://www.tiktok.com/@arenahub/live';
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
test('multi-platform links require a playable primary and treat TikTok as external',()=>{
  const links:BroadcastLink[]=[{platform:'youtube',url:yt},{platform:'facebook',url:fb},{platform:'tiktok',url:tt}];
  const result=validateBroadcastLinks(links,'facebook');assert.match(result.streamUrl!,/facebook.com\/plugins/);
  const view=matchBroadcasts(result);assert.equal(view[0].platform,'facebook');assert.equal(view.length,3);assert.equal(view.find(l=>l.platform==='tiktok')?.embedUrl,null);
  assert.throws(()=>validateBroadcastLinks([links[2]],'tiktok'),/player/);
  assert.throws(()=>validateBroadcastLinks([links[0],links[0]]),/once/);
  assert.throws(()=>validateBroadcastLinks([links[0]],'facebook'),/saved/);
  assert.equal(isWatchableLiveMatch({status:'live',broadcastLinks:[links[0]]}),true);
  assert.equal(isWatchableLiveMatch({status:'completed',broadcastLinks:links}),false);
  assert.equal(isWatchableLiveMatch({status:'live',broadcastLinks:[links[2]]}),false);
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
