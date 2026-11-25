// Plays one stream from the iPhone relay (MediaMTX) over WebRTC, using WHEP: post an SDP offer, get the answer back.
// Watch-only: the browser receives video and sends nothing. Candidates are gathered before the offer is sent, so no
// follow-up requests (trickle ICE) are needed.
export interface WhepSession { stream: MediaStream; close: () => void }

export async function playWhep(url: string, user: string, pass: string, onFail: () => void): Promise<WhepSession> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  let closed = false, resource = '';
  const close = () => {
    if (closed) return;
    closed = true;
    pc.close();
    // Tell the relay to free the viewer slot. Best effort: the relay also drops it when the connection dies.
    if (resource) void fetch(resource, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {});
  };
  const auth = 'Basic ' + btoa(user + ':' + pass);
  const stream = new MediaStream();
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = event => { stream.addTrack(event.track); };
  pc.onconnectionstatechange = () => { if (!closed && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) { close(); onFail(); } };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise<void>(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const done = () => { if (pc.iceGatheringState === 'complete') resolve(); };
      pc.addEventListener('icegatheringstatechange', done);
      // A slow STUN server must not hold the picture back; host candidates are already in the offer.
      setTimeout(resolve, 1500);
    });
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: auth }, body: pc.localDescription!.sdp, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(response.status === 404 ? 'This iPhone stopped sharing.' : `The iPhone relay answered ${response.status}.`);
    const location = response.headers.get('Location');
    if (location) resource = new URL(location, url).href;
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    return { stream, close };
  } catch (error) {
    close();
    throw error;
  }
}
