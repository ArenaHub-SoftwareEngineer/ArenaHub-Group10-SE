import React from 'react';

export interface CollegeLogoProps {
  code?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-10 h-10 text-xs',
  lg: 'w-14 h-14 text-sm',
  xl: 'w-20 h-20 text-base',
};

export const CollegeLogo: React.FC<CollegeLogoProps> = ({ code = '', size = 'md', className = '' }) => {
  const normalized = code.trim().toUpperCase();
  const sizeClasses = SIZE_MAP[size] || SIZE_MAP.md;

  switch (normalized) {
    case 'CCS':
      // College of Computing Studies - Cyber Shield with Circuitry & Core Node
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Computing Studies Logo"
        >
          <defs>
            <linearGradient id="ccs-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1E3A8A" />
              <stop offset="50%" stopColor="#2563EB" />
              <stop offset="100%" stopColor="#0284C7" />
            </linearGradient>
            <linearGradient id="ccs-glow" x1="16" y1="16" x2="48" y2="48" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#0EA5E9" />
            </linearGradient>
          </defs>
          {/* Shield Outer */}
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#ccs-grad)"
            stroke="#60A5FA"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Inner Accent Path */}
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#0F172A"
            opacity="0.6"
          />
          {/* Circuit Lines */}
          <path d="M22 22H27L30 26V34L26 38H20" stroke="#38BDF8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M42 22H37L34 26V34L38 38H44" stroke="#38BDF8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20" cy="22" r="1.75" fill="#38BDF8" />
          <circle cx="44" cy="22" r="1.75" fill="#38BDF8" />
          <circle cx="20" cy="38" r="1.75" fill="#38BDF8" />
          <circle cx="44" cy="38" r="1.75" fill="#38BDF8" />
          {/* Central Processor & Prompt */}
          <rect x="26" y="25" width="12" height="12" rx="2.5" fill="url(#ccs-glow)" stroke="#93C5FD" strokeWidth="1.5" />
          <path d="M29 31L31.5 28.5L29 26" stroke="#0F172A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="33" y1="31" x2="35" y2="31" stroke="#0F172A" strokeWidth="1.5" strokeLinecap="round" />
          {/* College Acronym */}
          <text x="32" y="49" fill="#E0F2FE" fontSize="8" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            CCS
          </text>
        </svg>
      );

    case 'COE':
      // College of Engineering - Mechanical Gear & Caliper Shield
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Engineering Logo"
        >
          <defs>
            <linearGradient id="coe-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#991B1B" />
              <stop offset="50%" stopColor="#DC2626" />
              <stop offset="100%" stopColor="#B91C1C" />
            </linearGradient>
            <linearGradient id="coe-gold" x1="16" y1="16" x2="48" y2="48" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
          </defs>
          {/* Shield Outer */}
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#coe-grad)"
            stroke="#FCA5A5"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Inner Dark Plate */}
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#18181B"
            opacity="0.6"
          />
          {/* Gear Shape */}
          <g transform="translate(32 30)">
            <path
              d="M-4 -14H4L5 -11L8 -10L11 -12L14 -7L12 -4L13 -1H15V4H13L12 7L14 10L11 14L8 12L5 13L4 15H-4L-5 13L-8 12L-11 14L-14 10L-12 7L-13 4H-15V-1H-13L-12 -4L-14 -7L-11 -12L-8 -10L-5 -11L-4 -14Z"
              fill="url(#coe-gold)"
              stroke="#FDE68A"
              strokeWidth="1"
            />
            <circle cx="0" cy="0" r="5" fill="#18181B" stroke="#FDE68A" strokeWidth="1.5" />
            {/* Compass / Caliper divider */}
            <path d="M0 -3L-7 11M0 -3L7 11" stroke="#FEF08A" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="0" cy="-3" r="1.5" fill="#FEF08A" />
          </g>
          {/* College Acronym */}
          <text x="32" y="49" fill="#FEF3C7" fontSize="8" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            COE
          </text>
        </svg>
      );

    case 'CN':
      // College of Nursing - Nightingale Lamp & Caduceus Cross Shield
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Nursing Logo"
        >
          <defs>
            <linearGradient id="cn-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#064E3B" />
              <stop offset="50%" stopColor="#059669" />
              <stop offset="100%" stopColor="#10B981" />
            </linearGradient>
          </defs>
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#cn-grad)"
            stroke="#6EE7B7"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#06281E"
            opacity="0.65"
          />
          {/* Nightingale Lamp & Heart */}
          <path
            d="M23 27C23 23 28 20 32 20C36 20 41 23 41 27C41 32 37 34 32 37C27 34 23 32 23 27Z"
            fill="#ECFDF5"
            opacity="0.25"
          />
          {/* Medical Red / White Cross */}
          <rect x="29" y="20" width="6" height="16" rx="1.5" fill="#FFFFFF" />
          <rect x="24" y="25" width="16" height="6" rx="1.5" fill="#FFFFFF" />
          {/* Golden Flame */}
          <path
            d="M32 15C33.5 17 34 18.5 33 20C32.5 19.5 31.5 19 32 17.5C31.5 18 31 19 31 20C30 18.5 30.5 17 32 15Z"
            fill="#FBBF24"
          />
          {/* College Acronym */}
          <text x="32" y="49" fill="#ECFDF5" fontSize="8" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            CN
          </text>
        </svg>
      );

    case 'CCJE':
      // College of Criminal Justice Education - Sheriff Star Badge & Scales Shield
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Criminal Justice Education Logo"
        >
          <defs>
            <linearGradient id="ccje-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#78350F" />
              <stop offset="50%" stopColor="#D97706" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>
            <linearGradient id="ccje-star" x1="18" y1="18" x2="46" y2="46" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FEF3C7" />
              <stop offset="100%" stopColor="#FCD34D" />
            </linearGradient>
          </defs>
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#ccje-grad)"
            stroke="#FDE68A"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#1E1E24"
            opacity="0.65"
          />
          {/* Star Badge of Justice */}
          <path
            d="M32 17L35 24H42L36.5 28.5L38.5 36L32 31.5L25.5 36L27.5 28.5L22 24H29L32 17Z"
            fill="url(#ccje-star)"
            stroke="#B45309"
            strokeWidth="1"
          />
          {/* Scales of Justice Beam */}
          <line x1="26" y1="26" x2="38" y2="26" stroke="#78350F" strokeWidth="1.5" />
          <path d="M26 26L24 31H28L26 26Z" fill="#78350F" />
          <path d="M38 26L36 31H40L38 26Z" fill="#78350F" />
          {/* College Acronym */}
          <text x="32" y="49" fill="#FFFBEB" fontSize="7.5" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            CCJE
          </text>
        </svg>
      );

    case 'CL':
      // College of Law - Jurisprudence Pillars & Gavel Shield
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Law Logo"
        >
          <defs>
            <linearGradient id="cl-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4C1D95" />
              <stop offset="50%" stopColor="#7C3AED" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#cl-grad)"
            stroke="#DDD6FE"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#1E1035"
            opacity="0.65"
          />
          {/* Temple Pediment & Pillars */}
          <path d="M22 20L32 15L42 20H22Z" fill="#F5D0FE" stroke="#E9D5FF" strokeWidth="1" />
          <rect x="24" y="21" width="3" height="15" rx="0.5" fill="#FAF5FF" />
          <rect x="30.5" y="21" width="3" height="15" rx="0.5" fill="#FAF5FF" />
          <rect x="37" y="21" width="3" height="15" rx="0.5" fill="#FAF5FF" />
          <rect x="20" y="36" width="24" height="3" rx="1" fill="#F5D0FE" />
          {/* College Acronym */}
          <text x="32" y="49" fill="#FAF5FF" fontSize="8" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            CL
          </text>
        </svg>
      );

    case 'CA':
      // College of Architecture - Blueprint Compass & Neoclassical Dome
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Architecture Logo"
        >
          <defs>
            <linearGradient id="ca-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#831843" />
              <stop offset="50%" stopColor="#DB2777" />
              <stop offset="100%" stopColor="#EC4899" />
            </linearGradient>
          </defs>
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#ca-grad)"
            stroke="#FBCFE8"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#280D1A"
            opacity="0.65"
          />
          {/* Compass & T-Square Blueprint */}
          <path d="M32 16L22 36H26L32 23L38 36H42L32 16Z" fill="#FDF2F8" stroke="#F472B6" strokeWidth="1" />
          <circle cx="32" cy="18" r="2.5" fill="#F472B6" />
          <path d="M25 30H39" stroke="#FDF2F8" strokeWidth="1.5" strokeLinecap="round" />
          {/* College Acronym */}
          <text x="32" y="49" fill="#FDF2F8" fontSize="8" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            CA
          </text>
        </svg>
      );

    case 'CLA':
      // College of Liberal Arts - Apollo Lyre & Wisdom Quill Feather
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Liberal Arts Logo"
        >
          <defs>
            <linearGradient id="cla-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#312E81" />
              <stop offset="50%" stopColor="#4F46E5" />
              <stop offset="100%" stopColor="#6366F1" />
            </linearGradient>
          </defs>
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#cla-grad)"
            stroke="#C7D2FE"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#12103E"
            opacity="0.65"
          />
          {/* Classical Lyre of the Humanities */}
          <path
            d="M24 18C24 28 26 35 32 37C38 35 40 28 40 18C37 20 35 23 35 27C35 30 33 32 32 32C31 32 29 30 29 27C29 23 27 20 24 18Z"
            fill="#E0E7FF"
            stroke="#A5B4FC"
            strokeWidth="1"
          />
          <line x1="30.5" y1="21" x2="30.5" y2="33" stroke="#818CF8" strokeWidth="1" />
          <line x1="33.5" y1="21" x2="33.5" y2="33" stroke="#818CF8" strokeWidth="1" />
          {/* College Acronym */}
          <text x="32" y="49" fill="#EEF2FF" fontSize="7.5" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            CLA
          </text>
        </svg>
      );

    case 'CED':
      // College of Education - Blazing Torch of Knowledge & Open Book
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="College of Education Logo"
        >
          <defs>
            <linearGradient id="ced-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#115E59" />
              <stop offset="50%" stopColor="#0D9488" />
              <stop offset="100%" stopColor="#14B8A6" />
            </linearGradient>
            <linearGradient id="ced-flame" x1="28" y1="14" x2="36" y2="26" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#EF4444" />
            </linearGradient>
          </defs>
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#ced-grad)"
            stroke="#99F6E4"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#082A26"
            opacity="0.65"
          />
          {/* Flaming Torch of Education */}
          <path
            d="M32 14C35 18 36 21 34 24C33 22 31.5 21 32 19C31 20 30 22 30 24C28 21 29 18 32 14Z"
            fill="url(#ced-flame)"
          />
          <path d="M29 24H35L33 34H31L29 24Z" fill="#FDE68A" stroke="#B45309" strokeWidth="0.75" />
          {/* Open Book of Learning */}
          <path d="M22 34C26 32 30 33 32 36C34 33 38 32 42 34V38C38 36 34 37 32 40C30 37 26 36 22 38V34Z" fill="#F0FDFA" />
          {/* College Acronym */}
          <text x="32" y="49" fill="#CCFBF1" fontSize="8" fontWeight="800" textAnchor="middle" letterSpacing="0.5" fontFamily="system-ui, sans-serif">
            CED
          </text>
        </svg>
      );

    default:
      // Generic Campus Shield fallback
      return (
        <svg
          viewBox="0 0 64 64"
          className={`${sizeClasses} shrink-0 drop-shadow-md ${className}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label={`${normalized || 'Team'} Logo`}
        >
          <defs>
            <linearGradient id="gen-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1E293B" />
              <stop offset="50%" stopColor="#334155" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
          </defs>
          <path
            d="M32 4L54 12V28C54 42.5 44.5 54.5 32 60C19.5 54.5 10 42.5 10 28V12L32 4Z"
            fill="url(#gen-grad)"
            stroke="#94A3B8"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M32 9L49 15.5V27C49 39.5 41.5 49.5 32 54C22.5 49.5 15 39.5 15 27V15.5L32 9Z"
            fill="#0F172A"
            opacity="0.6"
          />
          <text
            x="32"
            y="37"
            fill="#F8FAFC"
            fontSize={normalized.length > 3 ? "11" : "13"}
            fontWeight="800"
            textAnchor="middle"
            letterSpacing="0.5"
            fontFamily="system-ui, sans-serif"
          >
            {normalized.slice(0, 4) || 'WMSU'}
          </text>
        </svg>
      );
  }
};
