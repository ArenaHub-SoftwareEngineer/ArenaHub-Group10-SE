import React from 'react';
import { SpectatorAIView } from '../spectator/SpectatorAIView';

interface AIAssistantViewProps {
  currentUser?: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatarInitials: string;
    collegeName?: string;
  };
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onOpenBrackets?: () => void;
}

export const AIAssistantView: React.FC<AIAssistantViewProps> = (props) => (
  <SpectatorAIView {...props} />
);
