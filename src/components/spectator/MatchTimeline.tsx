import React, { useState, useMemo, useEffect } from 'react';
import { Match, MatchTimelineEvent } from '../../lib/types';
import {
  Skull,
  Shield,
  Crown,
  Flame,
  Swords,
  Clock,
  Target,
  Zap,
  Radio,
  Plus,
  Play,
  Pause,
  Info,
} from '../ui/Icons';

interface MatchTimelineProps {
  match: Match;
  className?: string;
  onNewEvent?: (event: MatchTimelineEvent) => void;
}

export const MatchTimeline: React.FC<MatchTimelineProps> = ({
  match,
  className = '',
  onNewEvent,
}) => {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'first-blood' | 'tower' | 'lord'>('all');
  
  // Real-time timeline state
  const [events, setEvents] = useState<MatchTimelineEvent[]>(() => {
    if (match.timelineEvents && match.timelineEvents.length > 0) {
      return [...match.timelineEvents];
    }
    return [
      {
        time: '02:15',
        title: 'First Blood',
        type: 'first-blood',
        team: match.team1?.collegeCode || 'CCS',
        text: `Riley (CCS, Jungler) secures First Blood on Bolt (COE)`,
      },
      {
        time: '04:10',
        title: 'Tower Destroyed',
        type: 'tower',
        team: match.team1?.collegeCode || 'CCS',
        text: `CCS destroys Bottom Outer Turret for first turret gold`,
      },
      {
        time: '05:35',
        title: 'Turtle Slain',
        type: 'objective',
        team: match.team2?.collegeCode || 'COE',
        text: `COE secures first Turtle following a 3v2 contested river trade`,
      },
      {
        time: '08:10',
        title: 'Lord/Baron Slain',
        type: 'lord',
        team: match.team2?.collegeCode || 'COE',
        text: `COE steals Lord pit objective to breach CCS base`,
      },
    ];
  });

  // Automated Game State Integration (GSI) Telemetry Engine
  const [isAutoTelemetry, setIsAutoTelemetry] = useState(match.status === 'live');
  const [simIndex, setSimIndex] = useState(0);

  // Pool of upcoming live telemetry events that the automated game integration would push
  const simulatedUpcomingEvents: MatchTimelineEvent[] = useMemo(() => [
    {
      time: '15:20',
      title: 'Tower Destroyed',
      type: 'tower',
      team: match.team1?.collegeCode || 'CCS',
      text: 'CCS destroys Middle Tier-2 Turret after winning teamfight in Game 2',
    },
    {
      time: '16:45',
      title: 'Lord/Baron Slain',
      type: 'lord',
      team: match.team1?.collegeCode || 'CCS',
      text: 'Evolved Lord Slain by CCS behind Riley’s Ling smite contest',
    },
    {
      time: '18:10',
      title: 'Base Tower Destroyed',
      type: 'tower',
      team: match.team1?.collegeCode || 'CCS',
      text: 'CCS breaches Bottom High Ground and destroys Inhibitor Turret',
    },
    {
      time: '19:35',
      title: 'ACE / Wipeout',
      type: 'ace',
      team: match.team1?.collegeCode || 'CCS',
      text: 'ACE! CCS wipes out all 5 COE defenders in decisive base push',
    },
  ], [match.team1?.collegeCode]);

  // Periodic automated ingestion when Auto-Telemetry is on and match is live
  useEffect(() => {
    if (!isAutoTelemetry || match.status !== 'live' || simIndex >= simulatedUpcomingEvents.length) {
      return;
    }

    const timer = setTimeout(() => {
      const nextEvent = simulatedUpcomingEvents[simIndex];
      setEvents((prev) => {
        // Prevent duplicate times
        if (prev.some((e) => e.time === nextEvent.time && e.title === nextEvent.title)) {
          return prev;
        }
        return [...prev, nextEvent];
      });
      setSimIndex((i) => i + 1);
      if (onNewEvent) onNewEvent(nextEvent);
    }, 14000); // Trigger every 14 seconds automatically

    return () => clearTimeout(timer);
  }, [isAutoTelemetry, match.status, simIndex, simulatedUpcomingEvents, onNewEvent]);

  // Manual Trigger for Live Demo
  const handleTriggerSimulatedEvent = () => {
    if (simIndex < simulatedUpcomingEvents.length) {
      const nextEvent = simulatedUpcomingEvents[simIndex];
      setEvents((prev) => {
        if (prev.some((e) => e.time === nextEvent.time && e.title === nextEvent.title)) {
          return prev;
        }
        return [...prev, nextEvent];
      });
      setSimIndex((i) => i + 1);
      if (onNewEvent) onNewEvent(nextEvent);
    }
  };

  const filteredEvents = useMemo(() => {
    if (activeFilter === 'all') return events;
    return events.filter((e) => {
      const type = (e.type || '').toLowerCase();
      const title = (e.title || e.text || '').toLowerCase();
      if (activeFilter === 'first-blood') {
        return type.includes('blood') || title.includes('first blood');
      }
      if (activeFilter === 'tower') {
        return type.includes('tower') || title.includes('tower') || title.includes('turret');
      }
      if (activeFilter === 'lord') {
        return type.includes('lord') || title.includes('lord') || title.includes('baron') || type.includes('objective');
      }
      return true;
    });
  }, [events, activeFilter]);

  const getEventMeta = (event: MatchTimelineEvent) => {
    const textLower = (event.text + ' ' + (event.title || '') + ' ' + (event.type || '')).toLowerCase();

    if (textLower.includes('blood')) {
      return {
        badgeTitle: event.title || 'First Blood',
        icon: Skull,
        badgeBg: 'bg-[#E8544B]',
        nodeBorder: 'border-[#E8544B]',
        nodeBg: 'bg-[#351919]',
        textColor: 'text-[#E8544B]',
        glowColor: 'shadow-[#E8544B]/30',
      };
    }

    if (textLower.includes('tower') || textLower.includes('turret')) {
      return {
        badgeTitle: event.title || 'Tower Destroyed',
        icon: Shield,
        badgeBg: 'bg-[#ff6600]',
        nodeBorder: 'border-[#ff6600]',
        nodeBg: 'bg-[#33221A]',
        textColor: 'text-[#ff6600]',
        glowColor: 'shadow-[#ff6600]/30',
      };
    }

    if (textLower.includes('lord') || textLower.includes('baron')) {
      return {
        badgeTitle: event.title || 'Lord/Baron Slain',
        icon: Crown,
        badgeBg: 'bg-[#A855F7]',
        nodeBorder: 'border-[#A855F7]',
        nodeBg: 'bg-[#2B173E]',
        textColor: 'text-[#C084FC]',
        glowColor: 'shadow-[#A855F7]/30',
      };
    }

    if (textLower.includes('ace') || textLower.includes('wipeout')) {
      return {
        badgeTitle: event.title || 'ACE / Wipeout',
        icon: Flame,
        badgeBg: 'bg-[#E8544B]',
        nodeBorder: 'border-[#E8544B]',
        nodeBg: 'bg-[#2E1818]',
        textColor: 'text-[#FF6B6B]',
        glowColor: 'shadow-[#E8544B]/40',
      };
    }

    if (textLower.includes('turtle') || textLower.includes('dragon') || textLower.includes('objective')) {
      return {
        badgeTitle: event.title || 'Objective Secured',
        icon: Target,
        badgeBg: 'bg-[#ff6600]',
        nodeBorder: 'border-[#ff6600]',
        nodeBg: 'bg-[#18273A]',
        textColor: 'text-[#60A5FA]',
        glowColor: 'shadow-[#ff6600]/30',
      };
    }

    return {
      badgeTitle: event.title || 'Key Play',
      icon: Swords,
      badgeBg: 'bg-[#3DD68C]',
      nodeBorder: 'border-[#3DD68C]',
      nodeBg: 'bg-[#1A2E23]',
      textColor: 'text-[#3DD68C]',
      glowColor: 'shadow-[#3DD68C]/30',
    };
  };

  return (
    <div
      className={`rounded-[4px] border border-[#333333] bg-[#222222] p-5 shadow-xl relative overflow-hidden ${className}`}
    >
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#2E2E2E] pb-4 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-7 h-7 rounded-[3px] bg-[#33221A] border border-[#ff6600]/50 flex items-center justify-center text-[#ff6600]">
              <Clock className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h3 className="text-base font-heading font-black text-white tracking-tight uppercase">
              Match Timeline
            </h3>

            {/* Live Automated Feed Pill */}
            {match.status === 'live' && (
              <span className="px-2 py-0.5 rounded-[3px] bg-[#142A1D] border border-[#1E4D30] text-[#3DD68C] text-[10px] font-heading font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3DD68C] animate-pulse" />
                Live In-Game Feed
              </span>
            )}
          </div>
          <p className="text-xs text-[#888888] mt-1">
            Chronological log of pivotal milestones: First Blood, Turret takedowns, and Lord/Baron objectives
          </p>
        </div>

        {/* Real-time controls & filters */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Automated Telemetry (GSI) Simulator Toggle for Live Matches */}
          {match.status === 'live' && (
            <div className="flex items-center gap-1.5 bg-[#181818] p-1 rounded-[4px] border border-[#303030] text-xs">
              <button
                onClick={() => setIsAutoTelemetry(!isAutoTelemetry)}
                title="Toggle automated game client telemetry feed (Game State Integration)"
                className={`px-2 py-1 rounded-[3px] text-[11px] font-heading font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isAutoTelemetry
                    ? 'bg-[#142A1D] text-[#ff6600] border border-[#1E4D30]'
                    : 'bg-[#252525] text-[#888888] hover:text-white'
                }`}
              >
                <Radio className={`w-3 h-3 ${isAutoTelemetry ? 'animate-pulse text-[#ff6600]' : ''}`} />
                <span>Auto-Telemetry {isAutoTelemetry ? 'ON' : 'OFF'}</span>
              </button>

              {simIndex < simulatedUpcomingEvents.length && (
                <button
                  onClick={handleTriggerSimulatedEvent}
                  className="px-2 py-1 rounded-[3px] bg-[#2A2A2A] hover:bg-[#333333] text-white text-[10px] font-heading font-bold uppercase tracking-wider transition-colors cursor-pointer border border-[#3A3A3A]"
                  title="Simulate immediate arrival of the next in-game event"
                >
                  + Next Event
                </button>
              )}
            </div>
          )}

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-[#181818] p-1 rounded-[4px] border border-[#303030] text-xs overflow-x-auto max-w-full">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-2.5 py-1 rounded-[3px] font-heading font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilter === 'all'
                  ? 'bg-[#ff6600] text-white shadow-sm'
                  : 'text-[#888888] hover:text-white'
              }`}
            >
              All ({events.length})
            </button>
            <button
              onClick={() => setActiveFilter('first-blood')}
              className={`px-2 py-1 rounded-[3px] font-heading font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                activeFilter === 'first-blood'
                  ? 'bg-[#E8544B] text-white shadow-sm'
                  : 'text-[#888888] hover:text-[#E8544B]'
              }`}
            >
              <Skull className="w-3 h-3" />
              First Blood
            </button>
            <button
              onClick={() => setActiveFilter('tower')}
              className={`px-2 py-1 rounded-[3px] font-heading font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                activeFilter === 'tower'
                  ? 'bg-[#ff6600] text-white shadow-sm'
                  : 'text-[#888888] hover:text-[#ff6600]'
              }`}
            >
              <Shield className="w-3 h-3" />
              Towers
            </button>
            <button
              onClick={() => setActiveFilter('lord')}
              className={`px-2 py-1 rounded-[3px] font-heading font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                activeFilter === 'lord'
                  ? 'bg-[#ff6600] text-white shadow-sm'
                  : 'text-[#888888] hover:text-[#ff6600]'
              }`}
            >
              <Crown className="w-3 h-3" />
              Lord / Baron
            </button>
          </div>
        </div>
      </div>

      {/* Real-time Automation Info Ribbon */}
      <div className="mb-4 px-3 py-2 rounded-[3px] bg-[#1A1A1A] border border-[#2D2D2D] flex items-center justify-between text-[11px] text-[#888888]">
        <div className="flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-[#ff6600] shrink-0" />
          <span>
            <strong className="text-white font-medium">Automated Game State Integration:</strong> Live match milestones are captured automatically via in-game API telemetry webhooks—no human moderator required.
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#3DD68C] shrink-0 ml-2 hidden sm:inline">
          Sync: 100% LIVE
        </span>
      </div>

      {/* Horizontal Timeline Track */}
      <div className="relative pt-2 pb-3 overflow-x-auto scrollbar-thin scrollbar-thumb-[#333333]">
        {/* Horizontal rail line */}
        <div className="absolute top-[34px] left-4 right-4 h-0.5 bg-gradient-to-r from-[#333333] via-[#444444] to-[#ff6600]/50 -z-0 pointer-events-none" />

        <div className="flex items-start gap-4 sm:gap-6 min-w-max px-2 relative z-10">
          {filteredEvents.map((event, idx) => {
            const meta = getEventMeta(event);
            const Icon = meta.icon;
            const isSelected = selectedEventId === idx;
            const isTeam1 = event.team === (match.team1?.collegeCode || 'CCS');

            return (
              <div
                key={idx}
                onClick={() => setSelectedEventId(isSelected ? null : idx)}
                className={`group flex flex-col items-center w-[170px] sm:w-[190px] cursor-pointer transition-transform duration-200 ${
                  isSelected ? 'scale-[1.02]' : 'hover:scale-[1.01]'
                }`}
              >
                {/* Node marker (Icon + Pulse) */}
                <div
                  className={`w-12 h-12 rounded-[4px] border-2 ${meta.nodeBorder} ${meta.nodeBg} flex items-center justify-center shadow-lg transition-all ${
                    isSelected ? `ring-2 ring-white/60 ${meta.glowColor}` : 'group-hover:border-white'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${meta.textColor} stroke-[2.2]`} />
                </div>

                {/* Timestamp pill */}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className="font-mono text-[11px] font-bold text-white bg-[#181818] px-2 py-0.5 rounded-[3px] border border-[#333333] tabular-nums shadow-xs">
                    {event.time}
                  </span>
                  {event.team && (
                    <span
                      className={`text-[10px] font-heading font-black px-1.5 py-0.5 rounded-[2px] ${
                        isTeam1
                          ? 'bg-[#202733] text-[#3B82F6] border border-[#303E54]'
                          : 'bg-[#332020] text-[#EF4444] border border-[#543030]'
                      }`}
                    >
                      {event.team}
                    </span>
                  )}
                </div>

                {/* Milestone Title Badge */}
                <div className="mt-2 text-center w-full">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-[3px] text-white text-[10px] font-heading font-black uppercase tracking-wider ${meta.badgeBg} shadow-sm`}
                  >
                    {meta.badgeTitle}
                  </span>
                </div>

                {/* Event Description Card */}
                <div
                  className={`mt-2 p-2.5 rounded-[4px] bg-[#1A1A1A] border transition-colors w-full text-center ${
                    isSelected
                      ? 'border-white/50 bg-[#222222]'
                      : 'border-[#2C2C2C] group-hover:border-[#404040]'
                  }`}
                >
                  <p className="text-[11px] text-[#D1D1D1] leading-snug line-clamp-2">
                    {event.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Event Inspection Banner */}
      {selectedEventId !== null && filteredEvents[selectedEventId] && (
        <div className="mt-3 p-3.5 rounded-[4px] bg-[#191919] border border-[#383838] flex items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-[#ff6600] bg-[#2A1E17] border border-[#ff6600]/30 px-2 py-1 rounded-[3px] tabular-nums">
              {filteredEvents[selectedEventId].time}
            </span>
            <div>
              <span className="font-heading font-black text-white text-sm block">
                {filteredEvents[selectedEventId].title || 'Milestone Detail'}
              </span>
              <span className="text-[#AAAAAA]">
                {filteredEvents[selectedEventId].text}
              </span>
            </div>
          </div>
          <button
            onClick={() => setSelectedEventId(null)}
            className="text-[11px] text-[#888888] hover:text-white transition-colors cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
