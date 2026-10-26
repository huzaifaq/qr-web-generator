// Built-in library of custom dot shapes. Each is plain SVG source so it can be
// loaded into the shape editor and tweaked like an uploaded file.

export interface LibraryShape {
  id: string;
  name: string;
  svg: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Points of a regular star (`inner` > 0) or polygon (`inner` = 0) in a 100×100 box. */
function polygonPoints(sides: number, outer: number, inner = 0, rotation = -90): string {
  const pts: string[] = [];
  const steps = inner ? sides * 2 : sides;
  for (let i = 0; i < steps; i++) {
    const radius = inner && i % 2 ? inner : outer;
    const angle = ((rotation + (360 / steps) * i) * Math.PI) / 180;
    pts.push(`${r2(50 + radius * Math.cos(angle))},${r2(50 + radius * Math.sin(angle))}`);
  }
  return pts.join(' ');
}

const svg = (body: string, viewBox = '0 0 100 100') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n  ${body}\n</svg>`;

export const SHAPE_LIBRARY: LibraryShape[] = [
  { id: 'star', name: 'Star', svg: svg(`<polygon points="${polygonPoints(5, 50, 24)}"/>`, '2.45 0 95.1 90.45') },
  {
    id: 'heart',
    name: 'Heart',
    svg: svg('<path d="M50 90C22 70 4 54 4 32 4 16 16 6 30 6c9 0 16 5 20 12 4-7 11-12 20-12 14 0 26 10 26 26 0 22-18 38-46 58z"/>', '4 6 92 84'),
  },
  { id: 'diamond', name: 'Diamond', svg: svg('<polygon points="50,0 100,50 50,100 0,50"/>') },
  { id: 'hexagon', name: 'Hexagon', svg: svg(`<polygon points="${polygonPoints(6, 50, 0, 0)}"/>`, '0 6.7 100 86.6') },
  { id: 'octagon', name: 'Octagon', svg: svg(`<polygon points="${polygonPoints(8, 50, 0, 22.5)}"/>`, '3.8 3.8 92.4 92.4') },
  { id: 'circle', name: 'Circle', svg: svg('<circle cx="50" cy="50" r="50"/>') },
  { id: 'squircle', name: 'Squircle', svg: svg('<rect width="100" height="100" rx="30"/>') },
  { id: 'plus', name: 'Plus', svg: svg('<path d="M34 0h32v34h34v32H66v34H34V66H0V34h34z"/>') },
  { id: 'triangle', name: 'Triangle', svg: svg('<polygon points="50,0 100,88 0,88"/>', '0 0 100 88') },
  {
    id: 'sparkle',
    name: 'Sparkle',
    svg: svg('<path d="M50 0C54 34 66 46 100 50 66 54 54 66 50 100 46 66 34 54 0 50 34 46 46 34 50 0z"/>'),
  },
  { id: 'drop', name: 'Drop', svg: svg('<path d="M50 0s38 40 38 62a38 38 0 0 1-76 0C12 40 50 0 50 0z"/>', '12 0 76 100') },
  { id: 'bolt', name: 'Bolt', svg: svg('<polygon points="60,0 10,58 46,58 38,100 90,38 54,38"/>', '10 0 80 100') },
  {
    id: 'flower',
    name: 'Flower',
    svg: svg(
      [
        '<circle cx="50" cy="24" r="24"/>',
        '<circle cx="76" cy="50" r="24"/>',
        '<circle cx="50" cy="76" r="24"/>',
        '<circle cx="24" cy="50" r="24"/>',
        '<circle cx="50" cy="50" r="20"/>',
      ].join('\n  '),
    ),
  },
  {
    id: 'leaf',
    name: 'Leaf',
    svg: svg('<path d="M0 100C0 40 40 0 100 0c0 60-40 100-100 100z"/>'),
  },
  {
    id: 'cross',
    name: 'Cross',
    svg: svg('<path d="M20 0l30 30L80 0l20 20-30 30 30 30-20 20-30-30-30 30L0 80l30-30L0 20z"/>'),
  },
  { id: 'seal', name: 'Seal', svg: svg(`<polygon points="${polygonPoints(12, 50, 40)}"/>`) },
];

export const DEFAULT_SHAPE_SVG = SHAPE_LIBRARY[0].svg;
