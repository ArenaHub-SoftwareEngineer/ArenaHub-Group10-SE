/**
 * ArenaHub Custom SVG QR Code Renderer
 *
 * Standalone, zero-dependency QR code matrix generator with high visual contrast,
 * standard finder patterns, timing belts, and ArenaHub brand badge.
 */

import React, { useMemo } from 'react';

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
  bgColor?: string;
  fgColor?: string;
}

/**
 * Generate a pseudo-matrix based on text hash with real QR corner finder patterns
 */
function generateQRMatrix(text: string, size = 25): boolean[][] {
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // 1. Draw 7x7 Finder Pattern at (row, col)
  const drawFinder = (r: number, c: number) => {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        if (
          i === 0 ||
          i === 6 ||
          j === 0 ||
          j === 6 ||
          (i >= 2 && i <= 4 && j >= 2 && j <= 4)
        ) {
          matrix[r + i][c + j] = true;
        } else {
          matrix[r + i][c + j] = false;
        }
      }
    }
  };

  // Top-left, Top-right, Bottom-left finder patterns
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // 3. Alignment pattern at lower right
  const alR = size - 7;
  const alC = size - 7;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      matrix[alR + i][alC + j] = i === 0 && j === 0 ? true : Math.abs(i) === 1 || Math.abs(j) === 1;
    }
  }

  // 4. Data hash distribution for remainder modules
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Skip finder zones
      const inTL = r < 8 && c < 8;
      const inTR = r < 8 && c >= size - 8;
      const inBL = r >= size - 8 && c < 8;
      const inBR = r >= size - 8 && c >= size - 8;
      const inCenter = r >= 10 && r <= 14 && c >= 10 && c <= 14; // Leave room for badge

      if (!inTL && !inTR && !inBL && !inBR && !inCenter) {
        if (r !== 6 && c !== 6) {
          const bit = ((hash ^ (r * 37 + c * 19 + (r * c))) >> ((r + c) % 16)) & 1;
          matrix[r][c] = bit === 1;
        }
      }
    }
  }

  return matrix;
}

export const QRCode: React.FC<QRCodeProps> = ({
  value,
  size = 200,
  className = '',
  bgColor = '#FFFFFF',
  fgColor = '#000000',
}) => {
  const matrix = useMemo(() => generateQRMatrix(value, 25), [value]);
  const matrixSize = matrix.length;
  const cellSize = size / matrixSize;

  return (
    <div
      className={`relative inline-flex items-center justify-center p-3 rounded-[6px] shadow-lg ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="block"
      >
        {matrix.map((row, r) =>
          row.map((active, c) => {
            if (!active) return null;
            return (
              <rect
                key={`${r}-${c}`}
                x={c * cellSize}
                y={r * cellSize}
                width={cellSize + 0.15}
                height={cellSize + 0.15}
                fill={fgColor}
              />
            );
          })
        )}
      </svg>

      {/* Central ArenaHub badge */}
      <div
        className="absolute inset-0 m-auto flex items-center justify-center rounded-sm bg-[#191919] border-2 border-white shadow-md pointer-events-none"
        style={{ width: size * 0.22, height: size * 0.22 }}
      >
        <span className="font-heading font-black text-xs text-[#ff6600] tracking-tighter">
          A<span className="text-[#ff6600]">H</span>
        </span>
      </div>
    </div>
  );
};
