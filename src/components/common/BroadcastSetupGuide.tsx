import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from '../ui/Modal';
import './Broadcasting.css';

export function BroadcastSetupGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose} title="Broadcast setup" className="broadcast-guide-dialog">
    <ol className="broadcast-setup-steps">
      <li>Start the stream in your encoder and allow embedding on YouTube or Facebook.</li>
      <li>Paste the public video link in ArenaHub, check the preview, and upload a thumbnail.</li>
      <li>Select <strong>Go live</strong> to put the stream in Match center.</li>
    </ol>
    <div className="broadcast-note"><strong>Playback quality</strong>
      <p>Viewers use the provider’s adaptive player inside ArenaHub. Match your encoder settings to your upload speed, and check playback before publishing.</p>
    </div>
    <footer className="broadcast-guide-links">
      <a href="https://support.google.com/youtube/answer/2853702" target="_blank" rel="noopener noreferrer">YouTube encoder settings <ExternalLink size={12} /></a>
      <a href="https://support.google.com/youtube/answer/7444635" target="_blank" rel="noopener noreferrer">Stream latency and buffering <ExternalLink size={12} /></a>
    </footer>
  </Modal>;
}
