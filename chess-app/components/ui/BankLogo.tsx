/**
 * BankLogo — Official bank logos via SVG files in /public/banks/
 * Falls back to branded text badge for banks without SVG assets.
 */

export type BankKey = 'BCA' | 'Mandiri' | 'BRI' | 'BNI' | 'OCBC' | 'CIMB' | 'BSI' | 'Danamon' | 'Permata' | 'BTN';

interface BankLogoProps {
  bank: BankKey | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

// Banks that have real SVG assets in /public/banks/
const SVG_BANKS: Record<string, string> = {
  BCA:     '/banks/bca.svg',
  Mandiri: '/banks/mandiri.svg',
  BRI:     '/banks/bri.svg',
  BNI:     '/banks/bni.svg',
  OCBC:    '/banks/ocbc.svg',
};

// Fallback branded colors for banks without SVG assets
const BADGE_BANKS: Record<string, { bg: string; text: string; label: string }> = {
  CIMB:    { bg: '#C00000', text: '#FFFFFF', label: 'CIMB' },
  BSI:     { bg: '#00805F', text: '#FFFFFF', label: 'BSI' },
  Danamon: { bg: '#EB1C24', text: '#FFFFFF', label: 'Danamon' },
  Permata: { bg: '#6C3FA0', text: '#FFFFFF', label: 'Permata' },
  BTN:     { bg: '#003087', text: '#FFD600', label: 'BTN' },
};

const SIZE_PX = {
  sm: { w: 56, h: 28 },
  md: { w: 80, h: 40 },
  lg: { w: 120, h: 56 },
};

export default function BankLogo({ bank, size = 'md', showLabel = false }: BankLogoProps) {
  const dim = SIZE_PX[size];

  // Use real SVG image if available
  if (SVG_BANKS[bank]) {
    return (
      <div className="inline-flex flex-col items-center gap-1">
        <div
          className="flex items-center justify-center bg-white rounded-lg overflow-hidden"
          style={{ width: dim.w, height: dim.h, padding: size === 'sm' ? 4 : size === 'md' ? 6 : 8 }}
        >
          <img
            src={SVG_BANKS[bank]}
            alt={bank}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            draggable={false}
          />
        </div>
        {showLabel && (
          <span className="text-[10px] text-[var(--text-muted)] font-medium">{bank}</span>
        )}
      </div>
    );
  }

  // Fallback text badge for banks without SVG
  const badge = BADGE_BANKS[bank] || { bg: '#334155', text: '#FFFFFF', label: bank };
  const fontSize = size === 'sm' ? 9 : size === 'md' ? 11 : 14;

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div
        className="flex items-center justify-center rounded-lg font-extrabold tracking-wide"
        style={{
          width: dim.w,
          height: dim.h,
          backgroundColor: badge.bg,
          color: badge.text,
          fontSize,
        }}
      >
        {badge.label}
      </div>
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
