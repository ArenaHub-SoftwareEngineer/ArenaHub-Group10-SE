import React, { useState } from 'react';
import { aiService } from '../../lib/ai';
import { Sparkles, Send, X } from '../ui/Icons';
import { CleanFormattedText } from '../common/CleanFormattedText';

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDraft?: (draft: any) => void;
}

interface Message {
  sender: 'assistant' | 'user';
  text: string;
  groundedIn?: string;
  streaming?: boolean;
}

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({
  isOpen,
  onClose,
  onSelectDraft,
}) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'assistant',
      text: "Hi! I'm the ArenaHub assistant. Describe a bracket and I'll draft it, or ask about standings and matches.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || input;
    if (!textToSend.trim() || loading) return;

    const userMsg: Message = { sender: 'user', text: textToSend };
    const placeholderIdx = messages.length + 1;
    const assistantPlaceholder: Message = {
      sender: 'assistant',
      text: '',
      groundedIn: 'Gemini 2.0 Flash · ArenaHub Live Data',
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setInput('');
    setLoading(true);
    setStreamingIdx(placeholderIdx);

    try {
      let accumulated = '';
      const stream = aiService.streamAnswer(textToSend);
      for await (const chunk of stream) {
        accumulated += chunk.delta;
        setMessages((prev) =>
          prev.map((m, i) =>
            i === placeholderIdx ? { ...m, text: accumulated } : m
          )
        );
        if (chunk.done) break;
      }
      setMessages((prev) =>
        prev.map((m, i) =>
          i === placeholderIdx ? { ...m, streaming: false } : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === placeholderIdx ? { ...m, text: 'I encountered an error. Please try again.', streaming: false } : m
        )
      );
    } finally {
      setLoading(false);
      setStreamingIdx(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end sm:justify-end p-4 pointer-events-none">
      <div className="w-full sm:w-[420px] max-h-[85vh] h-[600px] bg-[#222222] border border-[#333333] rounded-[4px] shadow-2xl flex flex-col pointer-events-auto overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-200">
        {/* Header matching wireframe */}
        <div className="p-4 border-b border-[#2D2D2D] bg-[#1E1E1E] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#181D26] border border-[#2D3A4F] flex items-center justify-center text-[#ff6600]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-heading font-bold text-white tracking-tight">
                ArenaHub Assistant
              </h4>
              <div className="flex items-center gap-1.5 text-[11px] text-[#B3B3B3]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3DD68C]" />
                <span>Gemini 2.0 Flash</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#888888] hover:text-white p-1 rounded-[4px] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] p-3.5 rounded-[4px] text-xs leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-[#ff6600] text-black font-medium'
                    : 'bg-[#2A2A2A] text-white border border-[#383838]'
                }`}
              >
                {m.sender === 'user' ? (
                  m.text
                ) : (
                  <CleanFormattedText text={m.text} isStreaming={m.streaming} />
                )}
              </div>
            </div>
          ))}

          {loading && !streamingIdx && (
            <div className="flex items-center gap-2 p-3 bg-[#2A2A2A] border border-[#383838] rounded-[4px] max-w-[70%]">
              <span className="w-2 h-2 rounded-full bg-[#ff6600] animate-ping" />
              <span className="text-xs text-[#B3B3B3]">Thinking with Palaro data...</span>
            </div>
          )}
        </div>

        {/* Quick Suggestion Chips */}
        <div className="px-3 py-2 bg-[#1C1C1C] border-t border-[#2A2A2A] overflow-x-auto flex gap-1.5 shrink-0">
          <button
            onClick={() => handleSend('What happened in the CCS vs Engineering match?')}
            className="text-[10px] whitespace-nowrap px-2.5 py-1 rounded-[4px] bg-[#262626] hover:bg-[#333333] text-[#CCCCCC] transition-colors"
          >
            Match 48 Result
          </button>
          <button
            onClick={() => handleSend('Create a single-elimination bracket for Mobile Legends, seed by win rate, keep teams from the same college apart in round 1')}
            className="text-[10px] whitespace-nowrap px-2.5 py-1 rounded-[4px] bg-[#262626] hover:bg-[#333333] text-[#CCCCCC] transition-colors"
          >
            Draft Bracket
          </button>
          <button
            onClick={() => handleSend('Write me a python script to scrape data')}
            className="text-[10px] whitespace-nowrap px-2.5 py-1 rounded-[4px] bg-[#262626] hover:bg-[#333333] text-[#E8544B] transition-colors"
            title="Demonstrate out-of-scope refusal"
          >
            Test Refusal
          </button>
        </div>

        {/* Bottom Input Area */}
        <div className="p-3 bg-[#1E1E1E] border-t border-[#2D2D2D]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe a bracket or ask a question..."
              className="flex-1 bg-[#141414] border border-[#333333] focus:border-[#ff6600] rounded-[4px] px-3 py-2 text-xs text-white placeholder-[#666666] outline-hidden transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] disabled:opacity-40 text-black flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
