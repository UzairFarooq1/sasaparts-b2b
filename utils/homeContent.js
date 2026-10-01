// Content shown on the public home page. Each category links into /catalog?q=...
const S = (body) =>
  `<svg viewBox="0 0 64 64" fill="none" stroke="#3f444c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const categories = [
  // Two opposing pads, each with a backing-plate tab top and bottom.
  { name: 'Brake Pads', query: 'brake pad', icon: S('<path d="M28 12c-6 5-8 13-8 20s2 15 8 20"/><path d="M14 14c-5 5-7 12-7 18s2 13 7 18"/><path d="M14 14h14M14 50h28"/><path d="M36 12c6 5 8 13 8 20s-2 15-8 20"/><path d="M50 14c5 5 7 12 7 18s-2 13-7 18"/><path d="M50 14H36M50 50H36"/><path d="M7 32h50"/>') },
  // Vented disc: outer rotor, hub with wheel bolts, caliper on the upper right.
  { name: 'Brake Discs', query: 'brake disc', icon: S('<circle cx="32" cy="32" r="24"/><circle cx="32" cy="32" r="11"/><circle cx="32" cy="32" r="3.2"/><circle cx="32" cy="23" r="2.4"/><circle cx="40" cy="29" r="2.4"/><circle cx="37" cy="39" r="2.4"/><circle cx="27" cy="39" r="2.4"/><circle cx="24" cy="29" r="2.4"/><path d="M36 9v13h12a24 24 0 0 1 8 14H44"/>') },
  // Damper body on a diagonal with a coil wound around it and eyelets at both ends.
  { name: 'Shock Absorbers', query: 'shock absorber', icon: S('<circle cx="12" cy="52" r="6"/><path d="M16 48l24-24M24 40l16-16"/><path d="M20 30l22 8M26 24l22 8M32 18l22 8M38 12l16 6"/><path d="M44 8l10 10"/><circle cx="52" cy="12" r="3"/>') },
  // Ceramic insulator ribs, hex nut and threaded shell.
  { name: 'Spark Plugs', query: 'spark plug', icon: S('<path d="M31 6h2M29 12h6M28 18h8M28 24h8"/><path d="M27 24h10v8H27z"/><path d="M25 32h14v4H25z"/><path d="M26 36h12v18l-4 4h-4l-4-4z"/><path d="M26 42h12M26 48h12"/>') },
  // Jerrican with a carry handle and a chamfered top corner.
  { name: 'Engine Oil', query: 'engine oil', icon: S('<path d="M16 20h22l10 10v26H16z"/><path d="M24 20v-6h10v6"/><path d="M38 20v10h10"/><path d="M24 42h16"/>') },
  // CV joint: splined shaft into a pleated rubber boot and the outer race.
  { name: 'CV Joints', query: 'cv joint', icon: S('<path d="M6 28h12v8H6z"/><path d="M18 24l6-3v22l-6-3z"/><path d="M24 21l6 4v14l-6 4"/><path d="M30 25l6 2v10l-6 2"/><circle cx="44" cy="32" r="14"/><circle cx="44" cy="32" r="6"/><path d="M44 18v4M44 42v4M30 32h4M54 32h4"/>') },
  // Piston and connecting rod inside a gear.
  { name: 'Engine Parts', query: 'engine', icon: S('<circle cx="32" cy="34" r="18"/><path d="M24 14h16v10H24z"/><path d="M24 18h16"/><path d="M29 24h6v12h-6z"/><circle cx="32" cy="42" r="6"/><path d="M32 8v6M14 20l4 4M50 20l-4 4M8 34h6M50 34h6M16 48l4-4M48 48l-4-4M32 60v-6"/>') },
  // Spin-on canister with a pleated band and an oil droplet.
  { name: 'Oil Filters', query: 'oil filter', icon: S('<ellipse cx="28" cy="20" rx="16" ry="6"/><path d="M12 20v24c0 3.3 7.2 6 16 6s16-2.7 16-6V20"/><path d="M12 28c0 3.3 7.2 6 16 6s16-2.7 16-6"/><path d="M18 34v12M24 35v12M32 35v12M38 34v12"/><path d="M50 10c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/>') },
  // Panel filter with vertical pleats.
  { name: 'Air Filters', query: 'air filter', icon: S('<rect x="8" y="18" width="48" height="28" rx="4"/><path d="M16 18v28M24 18v28M32 18v28M40 18v28M48 18v28"/>') },
];

const popular = ['5W-30', 'Brake Pad', 'Wiper', 'Tyre', 'Coolant', 'Shock', 'Shell'];

module.exports = { categories, popular };
