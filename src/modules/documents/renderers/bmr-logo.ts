import { trusted, type SafeHtml } from "../html";

/**
 * The company mark of src/ui/brand.tsx (<Logo tagline />) as static SVG markup for the
 * framework-free renderers. Same geometry; the CSS variables are resolved to the brand colours of
 * src/app/globals.css because a stored, re-rendered document must not depend on page styles.
 * Keep in sync with brand.tsx (a test compares the two); replace both when the official vector
 * artwork is supplied (A-UX brand assets).
 */
const BRAND_600 = "#367a24";
const BRAND_800 = "#27581c";
const LIME_100 = "#e8f5d3";
const LIME_400 = "#8dc63f";
const GOLD_400 = "#e3b54a";
const FONT = "Poppins, Inter, Arial, sans-serif";

export function logoSvg(): SafeHtml {
  return trusted(
    `<svg viewBox="0 0 312 96" role="img" aria-label="Bryel&#39;s Care — Beauty and Wellness From Nature" xmlns="http://www.w3.org/2000/svg">` +
      `<g transform="translate(64 2)">` +
      `<ellipse cx="9" cy="12" rx="4.2" ry="9" transform="rotate(-28 9 12)" fill="${LIME_100}" stroke="${LIME_400}" stroke-width="2"/>` +
      `<ellipse cx="31" cy="12" rx="4.2" ry="9" transform="rotate(28 31 12)" fill="${LIME_100}" stroke="${LIME_400}" stroke-width="2"/>` +
      `<ellipse cx="20" cy="10" rx="4.8" ry="10" fill="${LIME_100}" stroke="${LIME_400}" stroke-width="2"/>` +
      `<circle cx="20" cy="3.2" r="2.4" fill="${GOLD_400}"/><circle cx="7" cy="5.5" r="1.8" fill="${GOLD_400}"/><circle cx="33" cy="5.5" r="1.8" fill="${GOLD_400}"/>` +
      `</g>` +
      `<text x="0" y="60" textLength="166" lengthAdjust="spacingAndGlyphs" font-family="${FONT}" font-weight="700" font-size="46" fill="${BRAND_600}" letter-spacing="-0.5">Bryel&#39;s</text>` +
      `<rect x="174" y="20" width="136" height="50" rx="25" fill="${BRAND_600}"/>` +
      `<text x="242" y="56" text-anchor="middle" textLength="100" lengthAdjust="spacingAndGlyphs" font-family="${FONT}" font-weight="600" font-size="38" fill="#ffffff">Care</text>` +
      `<text x="4" y="90" textLength="300" lengthAdjust="spacingAndGlyphs" font-family="${FONT}" font-style="italic" font-weight="600" font-size="13" fill="${BRAND_800}">Beauty and Wellness From Nature</text>` +
      `</svg>`,
  );
}
