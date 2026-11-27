// Tema grafico di ogni competizione per la pagina di configurazione: colori + stemma SVG originale
// (forme semplici, non i loghi ufficiali; per usare i loghi ufficiali vedi src/assets/leagues/README.md).
const ball = (fill = '#fff', stroke = 'rgba(0,0,0,.35)') =>
  `<circle cx="32" cy="32" r="22" fill="${fill}" stroke="${stroke}" stroke-width="2"/><polygon points="32,20 42,27 38,39 26,39 22,27" fill="#111"/>` +
  `<path d="M32 20V11M42 27l9-3M38 39l6 8M26 39l-6 8M22 27l-9-3" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>`;
const star = (cx, cy, r) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? r * 0.45 : r;
    return `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`;
  });
  return `<polygon points="${pts.join(' ')}" fill="#fff"/>`;
};
const letters = (text, size = 26) =>
  `<text x="32" y="${size > 24 ? 42 : 39}" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${size}" fill="#fff">${text}</text>`;

// Motorsport: stemmi semplici e originali (non i loghi ufficiali).
// Auto: targa con sigla + strisce di velocità. Moto: ruota con sigla.
const carBadge = (txt, fill, fg = '#fff') =>
  `<rect x="6" y="14" width="52" height="36" rx="9" fill="${fill}"/><path d="M6 41h52" stroke="${fg}" stroke-width="2" opacity=".35"/>` +
  `<path d="M12 22h12M12 28h8" stroke="${fg}" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>` +
  `<text x="36" y="38" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="22" font-style="italic" fill="${fg}">${txt}</text>`;
const wheelBadge = (txt, fill, fg = '#fff') =>
  `<circle cx="32" cy="32" r="23" fill="${fill}"/><circle cx="32" cy="32" r="23" fill="none" stroke="${fg}" stroke-width="3" stroke-dasharray="3 4" opacity=".55"/>` +
  `<circle cx="32" cy="32" r="15" fill="none" stroke="${fg}" stroke-width="3"/>` +
  `<text x="32" y="${txt.length > 2 ? 37 : 38}" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${txt.length > 2 ? 11 : 15}" fill="${fg}">${txt}</text>`;

export const LEAGUE_ART = {
  'serie-a': { bg: 'https://images.legaseriea.it/image/private/t_ratio16_9-size60-f_webp-c_fill/v1763030335/prd/assets/backgrounds/serie-a-bg-hero_gaxlca.png', c1: '#0b5fff', c2: '#00c2ff', note: 'Italia',
    svg: `<path d="M12 8h40v26c0 12-9 19-20 23C21 53 12 46 12 34z" fill="#fff"/><path d="M12 8h13v49C21 53 12 46 12 34z" fill="#009246"/><path d="M39 8h13v26c0 12-9 19-20 23h7z" fill="#ce2b37"/>${letters('A', 28).replace('fill="#fff"', 'fill="#0b3d91"').replace('y="42"', 'y="40"')}` },
  'serie-b': { bg: 'https://www.legab.it/_assets/1828dc9d1a12cc6a24cac3eb07a33e6e/Images/bg-seriebkt.jpg?1783333767', c1: '#00a896', c2: '#3ddc97', note: 'Italia',
    svg: `<path d="M12 8h40v26c0 12-9 19-20 23C21 53 12 46 12 34z" fill="#fff"/><rect x="12" y="8" width="40" height="9" fill="#00a896"/>${letters('B', 28).replace('fill="#fff"', 'fill="#00695f"').replace('y="42"', 'y="43"')}` },
  'champions-league': { bg: 'https://i.pinimg.com/736x/6e/b6/45/6eb645dff62ea194f90990de45c956b6.jpg', c1: '#0a1d8f', c2: '#4f7cff', note: 'Europa',
    svg: `<circle cx="32" cy="32" r="21" fill="#fff"/><circle cx="32" cy="32" r="14" fill="#0a1d8f"/>${star(32, 32, 9)}${star(32, 9, 4)}${star(32, 55, 4)}${star(9, 32, 4)}${star(55, 32, 4)}` },
  'europa-league': { bg: 'https://t3.ftcdn.net/jpg/15/07/69/36/360_F_1507693605_CGojOE40qdJigEOnTRbrqaUrmCumYs7Z.jpg', c1: '#ff6a00', c2: '#322d24', note: 'Europa',
    svg: `<circle cx="32" cy="32" r="22" fill="none" stroke="#fff" stroke-width="5"/><path d="M18 14l28 36M46 14L18 50" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/><circle cx="32" cy="32" r="8" fill="#fff"/>` },
  'premier-league': { bg: 'https://cdn.vectorstock.com/i/500p/70/69/purple-zigzag-epl-background-vector-58627069.jpg', c1: '#37003c', c2: '#00bdff', note: 'Inghilterra',
    svg: `<path d="M10 46l5-24 11 12 6-18 6 18 11-12 5 24z" fill="#fff"/><rect x="10" y="48" width="44" height="6" rx="2" fill="#00bdff"/><circle cx="15" cy="20" r="3" fill="#00bdff"/><circle cx="32" cy="14" r="3" fill="#00bdff"/><circle cx="49" cy="20" r="3" fill="#00bdff"/>` },
  'ligue-1': { logoBg: '#085fff', bg: 'https://www.gedeon.com/admin/wp-content/uploads/2025/09/IMG_OUT_LIGHT.png', c1: '#091c3e', c2: '#dae025', note: 'Francia',
    svg: `<rect x="10" y="10" width="44" height="44" rx="12" fill="#dae025"/>${letters('1', 38).replace('fill="#fff"', 'fill="#091c3e"').replace('y="42"', 'y="46"')}` },
  'bundesliga': { bg: '/league-logos/bg/bundesliga.png', c1: '#c8102e', c2: '#ff6b3d', note: 'Germania',
    svg: `<circle cx="32" cy="32" r="22" fill="#fff"/><path d="M14 40a22 22 0 0 1 36 0z" fill="#c8102e"/><path d="M14 40h36" stroke="#111" stroke-width="3"/><path d="M13 27a22 22 0 0 1 38 0" fill="none" stroke="#111" stroke-width="3"/>` },
  'la-liga': { bg: '/league-logos/bg/la-liga.png', c1: '#d6003a', c2: '#ff8aa1', note: 'Spagna',
    svg: `<circle cx="32" cy="32" r="22" fill="#fff"/><path d="M32 10a22 22 0 0 1 0 44 11 11 0 0 1 0-22 11 11 0 0 0 0-22z" fill="#d6003a"/><circle cx="32" cy="21" r="3" fill="#fff"/><circle cx="32" cy="43" r="3" fill="#d6003a"/>` },
  'formula-1': { c1: '#e10600', c2: '#15151e', note: 'F1 · F2 · F3', svg: carBadge('F1', '#e10600') },
  'motogp': { c1: '#ff3b1d', c2: '#111111', note: 'MotoGP · Moto2 · Moto3', svg: wheelBadge('GP', '#ff3b1d') },
};
export const ballSvg = ball;
