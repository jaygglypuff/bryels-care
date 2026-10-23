/**
 * Bryel's Care logo, redrawn as vector from the company's printed mark (BMR header):
 * "Bryel's" in leaf green, "Care" reversed out of a rounded green pill, a small crown of
 * petals above, and the tagline "Beauty and Wellness From Nature".
 * Replace with the official vector artwork when supplied (A-UX brand assets).
 */
export function Logo({ className, tagline = false, mono = false }: { className?: string; tagline?: boolean; mono?: boolean }) {
  const green = mono ? "currentColor" : "var(--brand-600)";
  const light = mono ? "currentColor" : "var(--lime-400)";
  const h = tagline ? 96 : 72;
  return (
    <svg viewBox={`0 0 312 ${h}`} className={className} role="img" aria-label="Bryel's Care — Beauty and Wellness From Nature">
      {/* crown of petals */}
      <g transform="translate(64 2)">
        <ellipse cx="9" cy="12" rx="4.2" ry="9" transform="rotate(-28 9 12)" fill="var(--lime-100)" stroke={light} strokeWidth="2" />
        <ellipse cx="31" cy="12" rx="4.2" ry="9" transform="rotate(28 31 12)" fill="var(--lime-100)" stroke={light} strokeWidth="2" />
        <ellipse cx="20" cy="10" rx="4.8" ry="10" fill="var(--lime-100)" stroke={light} strokeWidth="2" />
        <circle cx="20" cy="3.2" r="2.4" fill="var(--gold-400)" />
        <circle cx="7" cy="5.5" r="1.8" fill="var(--gold-400)" />
        <circle cx="33" cy="5.5" r="1.8" fill="var(--gold-400)" />
      </g>
      <text x="0" y="60" textLength="166" lengthAdjust="spacingAndGlyphs" fontFamily="var(--font-display)" fontWeight="700" fontSize="46" fill={green} letterSpacing="-0.5">
        Bryel&apos;s
      </text>
      <rect x="174" y="20" width="136" height="50" rx="25" fill={green} />
      <text x="242" y="56" textAnchor="middle" textLength="100" lengthAdjust="spacingAndGlyphs" fontFamily="var(--font-display)" fontWeight="600" fontSize="38" fill={mono ? "var(--surface)" : "#ffffff"}>
        Care
      </text>
      {tagline && (
        <text x="4" y="90" textLength="300" lengthAdjust="spacingAndGlyphs" fontFamily="var(--font-display)" fontStyle="italic" fontWeight="600" fontSize="13" fill={mono ? "currentColor" : "var(--brand-800)"}>
          Beauty and Wellness From Nature
        </text>
      )}
    </svg>
  );
}

/** Compact mark for small spaces (favicon, rail): the "Care" pill with a petal. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="Bryel's Care">
      <rect width="40" height="40" rx="12" fill="var(--brand-600)" />
      <path d="M11 27 C13 18, 18 13, 20 9 C22 13, 27 18, 29 27" fill="none" stroke="var(--lime-300)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20" cy="9.5" r="2.6" fill="var(--gold-400)" />
      <text x="20" y="33" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize="10" fill="#fff">
        BC
      </text>
    </svg>
  );
}
