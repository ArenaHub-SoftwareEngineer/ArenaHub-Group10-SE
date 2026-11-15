import React from 'react';
import { SpectatorAIView } from '../spectator/SpectatorAIView';
import { AIFeedbackReview } from './AIFeedbackReview';

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

/** The organizer workspace's Arena AI: the same assistant, plus the staff review of answer ratings. */
export const AIAssistantView: React.FC<AIAssistantViewProps> = (props) => (
  <SpectatorAIView {...props} headerActions={<AIFeedbackReview />} />
);
