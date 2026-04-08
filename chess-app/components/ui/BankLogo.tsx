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

// All banks use real official SVG assets from /public/banks/
const SVG_BANKS: Record<string, string> = {
  BCA:     '/banks/bca.svg',
  Mandiri: '/banks/mandiri.svg',
  BRI:     '/banks/bri.svg',
  BNI:     '/banks/bni.svg',
  OCBC:    '/banks/ocbc.svg',
  CIMB:    '/banks/cimb.svg',
  BSI:     '/banks/bsi.svg',
  Danamon: '/banks/danamon.svg',
  Permata: '/banks/permata.svg',
  BTN:     '/banks/btn.svg',
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

  // Unknown bank — generic grey badge fallback
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div
        className="flex items-center justify-center rounded-lg font-extrabold tracking-wide bg-slate-600 text-white"
        style={{ width: dim.w, height: dim.h, fontSize: size === 'sm' ? 9 : size === 'md' ? 11 : 14 }}
      >
        {bank}
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
              ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40'
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
