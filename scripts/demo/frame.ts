interface Segment {
  readonly text: string;
  readonly fill: string;
}

export type Line = readonly Segment[];

export interface Scene {
  readonly lines: readonly Line[];
  readonly cursor: boolean;
}

export const MIRAGON = {
  blue: '#335DE5',
  blueSoft: '#EEF1FD',
  green: '#00E676',
  amber: '#FFB000',
  grey: '#F9F7F7',
  black: '#1D1D1D',
  white: '#FFFFFF',
  line: '#E7E4E4',
  mutedOnLight: '#6F6F6F',
  mutedOnDark: '#BBBBBB',
};

export const CANVAS = { width: 1200, height: 700 };

const WINDOW = { x: 40, y: 34, width: 1120, height: 632, radius: 16 };
const HEADER_HEIGHT = 54;
const TERMINAL = {
  y: WINDOW.y + HEADER_HEIGHT,
  height: WINDOW.height - HEADER_HEIGHT,
  textX: WINDOW.x + 32,
  firstBaseline: WINDOW.y + HEADER_HEIGHT + 40,
  fontSize: 15,
  lineHeight: 24,
  rows: 22,
};
const MONO_ADVANCE = 0.6;
const PILL = { x: WINDOW.x + WINDOW.width - 124, y: WINDOW.y + 13, width: 100, height: 28 };

interface TextStyle {
  readonly size: number;
  readonly fill: string;
  readonly weight?: number;
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function monoCells(text: string, x: number, y: number, style: TextStyle): string {
  const advance = style.size * MONO_ADVANCE;
  const cellStarts = Array.from(text, (_, index) => x + index * advance).join(' ');
  return `<text x="${cellStarts}" y="${y}" font-family="Geist Mono" font-size="${style.size}" font-weight="${style.weight ?? 400}" fill="${style.fill}" xml:space="preserve">${escapeXml(text)}</text>`;
}

function windowDots(): string {
  const centerY = WINDOW.y + HEADER_HEIGHT / 2;
  return [0, 1, 2]
    .map(
      (dot) =>
        `<circle cx="${WINDOW.x + 28 + dot * 20}" cy="${centerY}" r="6" fill="${MIRAGON.line}"/>`,
    )
    .join('');
}

function header(): string {
  const baseline = WINDOW.y + 33;
  const location = 'engine / order-process / ';
  const instanceX = WINDOW.x + 96 + location.length * 14 * MONO_ADVANCE;
  return `${windowDots()}
${monoCells(location, WINDOW.x + 96, baseline, { size: 14, fill: MIRAGON.mutedOnLight })}
${monoCells('ORD-1001', instanceX, baseline, { size: 14, fill: MIRAGON.black, weight: 500 })}
<rect x="${PILL.x}" y="${PILL.y}" width="${PILL.width}" height="${PILL.height}" rx="${PILL.height / 2}" fill="${MIRAGON.blueSoft}"/>
<circle cx="${PILL.x + 17}" cy="${PILL.y + PILL.height / 2}" r="4" fill="${MIRAGON.blue}"/>
${monoCells('operate', PILL.x + 30, PILL.y + 19, { size: 13, fill: MIRAGON.blue, weight: 500 })}`;
}

function windowChrome(): string {
  const { x, y, width, height, radius } = WINDOW;
  return `<defs>
<filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="${MIRAGON.black}" flood-opacity="0.12"/></filter>
<clipPath id="window"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath>
</defs>
<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${MIRAGON.grey}"/>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${MIRAGON.white}" filter="url(#lift)"/>
<rect x="${x}" y="${TERMINAL.y}" width="${width}" height="${TERMINAL.height}" fill="${MIRAGON.black}" clip-path="url(#window)"/>
<rect x="${x + 0.5}" y="${y + 0.5}" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="none" stroke="${MIRAGON.line}"/>
${header()}`;
}

function rowBaseline(row: number): number {
  return TERMINAL.firstBaseline + row * TERMINAL.lineHeight;
}

function lineWidth(line: Line): number {
  return line.reduce((columns, segment) => columns + segment.text.length, 0);
}

function terminalLine(line: Line, row: number): string {
  const advance = TERMINAL.fontSize * MONO_ADVANCE;
  let column = 0;
  return line
    .map((segment) => {
      const x = TERMINAL.textX + column * advance;
      column += segment.text.length;
      return monoCells(segment.text, x, rowBaseline(row), {
        size: TERMINAL.fontSize,
        fill: segment.fill,
      });
    })
    .join('');
}

function cursor(line: Line, row: number): string {
  const advance = TERMINAL.fontSize * MONO_ADVANCE;
  const x = TERMINAL.textX + lineWidth(line) * advance;
  return `<rect x="${x}" y="${rowBaseline(row) - 15}" width="${advance}" height="19" fill="${MIRAGON.green}"/>`;
}

function terminal(scene: Scene): string {
  const visible = scene.lines.slice(-TERMINAL.rows);
  const lastRow = visible.length - 1;
  const text = visible.map(terminalLine).join('\n');
  return scene.cursor ? `${text}\n${cursor(visible[lastRow] ?? [], lastRow)}` : text;
}

export function frameSvg(scene: Scene): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}">
${windowChrome()}
${terminal(scene)}
</svg>`;
}
