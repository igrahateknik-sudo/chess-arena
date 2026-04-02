/**
 * BankLogo — Inline SVG bank logos for Indonesian banks
 * No CDN dependency, renders cleanly on dark/light backgrounds.
 */

export type BankKey = 'BCA' | 'Mandiri' | 'BRI' | 'BNI' | 'OCBC' | 'CIMB' | 'BSI' | 'Danamon' | 'Permata' | 'BTN';

interface BankLogoProps {
  bank: BankKey | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const BANK_META: Record<string, { bg: string; text: string; accent?: string; abbr: string }> = {
  BCA:     { bg: '#0066B3', text: '#FFFFFF', abbr: 'BCA' },
  Mandiri: { bg: '#003087', text: '#F9A01B', accent: '#F9A01B', abbr: 'Mandiri' },
  BRI:     { bg: '#005BAA', text: '#FFFFFF', accent: '#F47920', abbr: 'BRI' },
  BNI:     { bg: '#F16521', text: '#FFFFFF', accent: '#003087', abbr: 'BNI' },
  OCBC:    { bg: '#D0021B', text: '#FFFFFF', abbr: 'OCBC' },
  CIMB:    { bg: '#C00000', text: '#FFFFFF', abbr: 'CIMB' },
  BSI:     { bg: '#00805F', text: '#FFFFFF', abbr: 'BSI' },
  Danamon: { bg: '#EB1C24', text: '#FFFFFF', abbr: 'Danamon' },
  Permata: { bg: '#6C3FA0', text: '#FFFFFF', abbr: 'Permata' },
  BTN:     { bg: '#003087', text: '#FFD600', abbr: 'BTN' },
};

const SIZE = {
  sm: { w: 48, h: 24, font: 9 },
  md: { w: 64, h: 32, font: 11 },
  lg: { w: 96, h: 48, font: 15 },
};

export default function BankLogo({ bank, size = 'md', showLabel = false }: BankLogoProps) {
  const meta = BANK_META[bank] || { bg: '#334155', text: '#FFFFFF', abbr: bank };
  const dim = SIZE[size];

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg
        width={dim.w}
        height={dim.h}
        viewBox={`0 0 ${dim.w} ${dim.h}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={bank}
      >
        {/* Background rounded rect */}
        <rect width={dim.w} height={dim.h} rx={6} fill={meta.bg} />

        {/* Bank-specific designs */}
        {bank === 'BCA' && (
          <>
            {/* BCA stripe */}
            <rect x={dim.w - 12} y={0} width={12} height={dim.h} rx={0} fill="#004D8D" opacity="0.6" />
            <text
              x={dim.w / 2 - 4}
              y={dim.h / 2 + dim.font * 0.38}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontWeight="800"
              fontSize={dim.font + 2}
              fill={meta.text}
              letterSpacing="1"
            >
              BCA
            </text>
          </>
        )}

        {bank === 'Mandiri' && (
          <>
            {/* Mandiri yellow accent bar */}
            <rect x={0} y={dim.h - 5} width={dim.w} height={5} rx={0} fill="#F9A01B" />
            <text
              x={dim.w / 2}
              y={dim.h / 2 + dim.font * 0.35}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontWeight="800"
              fontSize={dim.font}
              fill={meta.text}
              letterSpacing="0.5"
            >
              Mandiri
            </text>
          </>
        )}

        {bank === 'BRI' && (
          <>
            <rect x={0} y={0} width={8} height={dim.h} fill="#F47920" />
            <text
              x={dim.w / 2 + 4}
              y={dim.h / 2 + dim.font * 0.38}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontWeight="900"
              fontSize={dim.font + 1}
              fill={meta.text}
              letterSpacing="1"
            >
              BRI
            </text>
          </>
        )}

        {bank === 'BNI' && (
          <>
            <rect x={0} y={0} width={dim.w / 2} height={dim.h} fill="#003087" />
            <text
              x={dim.w / 2}
              y={dim.h / 2 + dim.font * 0.38}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontWeight="900"
              fontSize={dim.font + 2}
              fill={meta.text}
              letterSpacing="1"
            >
              BNI
            </text>
          </>
        )}

        {bank === 'OCBC' && (
          <>
            <circle cx={dim.w - dim.h / 2} cy={dim.h / 2} r={dim.h / 2 - 3} fill="rgba(255,255,255,0.15)" />
            <text
              x={dim.w / 2 - 3}
              y={dim.h / 2 + dim.font * 0.38}
              textAnchor="middle"
              fontFamily="Arial, sans-serif"
              fontWeight="800"
              fontSize={dim.font}
              fill={meta.text}
              letterSpacing="0.5"
            >
              OCBC
            </text>
          </>
        )}

        {(bank === 'CIMB' || bank === 'BSI' || bank === 'Danamon' || bank === 'Permata' || bank === 'BTN') && (
          <text
            x={dim.w / 2}
            y={dim.h / 2 + dim.font * 0.38}
            textAnchor="middle"
            fontFamily="Arial, sans-serif"
            fontWeight="800"
            fontSize={bank === 'Danamon' || bank === 'Permata' ? dim.font - 1 : dim.font}
            fill={meta.text}
            letterSpacing="0.3"
          >
            {meta.abbr}
          </text>
        )}
      </svg>
      {showLabel && (
        <span className="text-[10px] text-[var(--text-muted)] font-medium">{bank}</span>
      )}
    </div>
  );
}

/** Grid of bank logo buttons for selection */
export function BankSelector({
  banks,
  selected,
  onSelect,
}: {
  banks: string[];
  selected: string;
  onSelect: (bank: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {banks.map(bank => (
        <button
          key={bank}
          type="button"
          onClick={() => onSelect(bank)}
          className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all
            ${selected === bank
              ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40'
              : 'border-[var(--border)] bg-[var(--bg-hover)] hover:border-[var(--text-muted)]/40'
            }`}
        >
          <BankLogo bank={bank} size="sm" />
          <span className="text-[9px] font-semibold text-[var(--text-muted)] truncate w-full text-center">{bank}</span>
        </button>
      ))}
    </div>
  );
}
