// The look plan, in one place. Monsoon Quarter at dusk: warm amber and teal neon against
// cool rain-blue shadow. Every colour in the game is one of these names; the same names are
// the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0c1420', // deep rain-blue night
  surface: '#1b2634', // walls and buildings
  hairline: '#2e3d4f', // crates, trim, stall frames
  ink: '#e9e6df', // allies, paper lanterns, bright cloth
  muted: '#8fa6b5', // secondary surfaces
  accent: '#f0a830', // amber neon: Site A, tea-house lanterns
  teal: '#2fd6c2', // teal neon: Site B, canal signs
  ember: '#ff5a3c', // enemy markers, danger
};

export function shade(name) {
  return PALETTE[name];
}
