import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { CANVAS, frameSvg, type Line, MIRAGON, type Scene } from './demo/frame.js';

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const CLI = root('dist/operate.js');
const PROCESS = root('test/integration/fixtures/order-process.bpmn');
const GIF = root('docs/assets/demo.gif');
const GEIST_MONO = 'https://raw.githubusercontent.com/vercel/geist-font/main/fonts/GeistMono/ttf';
const GEIST_MONO_FILES = ['GeistMono-Regular.ttf', 'GeistMono-Medium.ttf'];
const ENGINE_URL = process.env.OPERATE_URL ?? 'http://localhost:8080/engine-rest';

const FPS = 20;
const TYPED_CHARS_PER_FRAME = 2;
const BUSINESS_KEY = 'ORD-1001';
const INSPECT = ['inspect', '--business-key', BUSINESS_KEY, '--no-variables'];
const ADVANCE = ['advance', '--business-key', BUSINESS_KEY, '--var', 'approved=true'];

const work = mkdtempSync(join(tmpdir(), 'operate-demo-'));

function operate(args: readonly string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { OPERATE_URL: ENGINE_URL, OPERATE_OUTPUT: 'table', XDG_CONFIG_HOME: work },
  });
}

function requireBuiltCliAndFreshEngine(): void {
  if (!existsSync(CLI)) throw new Error(`${CLI} does not exist. Run \`npm run build\` first.`);
  operate(['ping']);
  const instances = operate(['process-instance', 'count', '--business-key', BUSINESS_KEY]);
  if (instances.trim() !== '0') {
    throw new Error(`${ENGINE_URL} already has an instance ${BUSINESS_KEY}: use a fresh engine.`);
  }
}

const seconds = (duration: number) => Math.round(duration * FPS);
const repeated = (scene: Scene, count: number) => Array.from({ length: count }, () => scene);
const commandLine = (args: readonly string[]) => `operate ${args.join(' ')}`;

function prompt(typed: string): Line {
  return [
    { text: '$ ', fill: MIRAGON.green },
    { text: typed, fill: MIRAGON.white },
  ];
}

function styledRow(row: string, previousRow: string, waitStateFill: string): Line {
  if (row.startsWith('Advanced')) {
    return [
      { text: 'Advanced', fill: MIRAGON.green },
      { text: row.slice('Advanced'.length), fill: MIRAGON.mutedOnDark },
    ];
  }
  if (previousRow.startsWith('ACTIVITY')) return [{ text: row, fill: waitStateFill }];
  if (/^[A-Z][a-z ]+:$/.test(row)) return [{ text: row, fill: MIRAGON.white }];
  return [{ text: row, fill: MIRAGON.mutedOnDark }];
}

function outputLines(output: string, waitStateFill: string): Line[] {
  const rows = output.trimEnd().split('\n');
  return [...rows.map((row, index) => styledRow(row, rows[index - 1] ?? '', waitStateFill)), []];
}

function typingScenes(before: readonly Line[], command: string): Scene[] {
  const scenes: Scene[] = [];
  for (
    let length = TYPED_CHARS_PER_FRAME;
    length < command.length;
    length += TYPED_CHARS_PER_FRAME
  ) {
    scenes.push({ lines: [...before, prompt(command.slice(0, length))], cursor: true });
  }
  return scenes;
}

function demoScenes(inspected: string, advanced: string): Scene[] {
  const command = commandLine(ADVANCE);
  const before = [prompt(commandLine(INSPECT)), ...outputLines(inspected, MIRAGON.amber)];
  const typed = [...before, prompt(command)];
  const after = [...typed, ...outputLines(advanced, MIRAGON.green), prompt('')];
  return [
    ...repeated({ lines: [...before, prompt('')], cursor: true }, seconds(2)),
    ...typingScenes(before, command),
    ...repeated({ lines: typed, cursor: true }, seconds(0.5)),
    ...repeated({ lines: after, cursor: true }, seconds(5)),
  ];
}

async function geistMono(): Promise<Uint8Array[]> {
  return Promise.all(
    GEIST_MONO_FILES.map(async (file) => {
      const response = await fetch(`${GEIST_MONO}/${file}`);
      return new Uint8Array(await response.arrayBuffer());
    }),
  );
}

async function rasterizer(): Promise<(svg: string) => Uint8Array> {
  const wasm = createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
  await initWasm(readFileSync(wasm));
  const font = {
    fontBuffers: await geistMono(),
    loadSystemFonts: false,
    defaultFontFamily: 'Geist Mono',
  };
  return (svg) => new Resvg(svg, { font }).render().asPng();
}

function writeFrames(scenes: readonly Scene[], rasterize: (svg: string) => Uint8Array): string[] {
  const rendered = new Map<string, Uint8Array>();
  return scenes.map((scene, index) => {
    const svg = frameSvg(scene);
    const png = rendered.get(svg) ?? rasterize(svg);
    rendered.set(svg, png);
    const file = join(work, `frame-${String(index).padStart(4, '0')}.png`);
    writeFileSync(file, png);
    return file;
  });
}

requireBuiltCliAndFreshEngine();
operate(['deploy', PROCESS, '--start', '--business-key', BUSINESS_KEY, '--var', 'amount=250']);
const scenes = demoScenes(operate(INSPECT), operate(ADVANCE));
const frames = writeFrames(scenes, await rasterizer());
mkdirSync(dirname(GIF), { recursive: true });
execFileSync(
  'gifski',
  ['--fps', String(FPS), '--width', String(CANVAS.width), '--quality', '90', '-o', GIF, ...frames],
  { stdio: 'ignore' },
);
console.log(`wrote ${GIF} (${frames.length} frames in ${work})`);
