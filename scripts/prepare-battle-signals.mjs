import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [buglePath, whistlePath] = process.argv.slice(2);
if (!buglePath || !whistlePath) throw new Error('Provide the reviewed Charge MP3 and SpliceSound whistle WAV');
const output = resolve('public\\assets\\audio\\battle-signals');
await mkdir(output, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  { id: 'bugle', author: 'United States Air Force Heritage of America Band', license: 'Public-Domain-US-Government',
    source: 'https://commons.wikimedia.org/wiki/File:Charge_-_Concert_Band_-_United_States_Air_Force_Heritage_of_America_Band.mp3',
    licenseUrl: 'https://www.music.af.mil/Multimedia/Music/Public-Domain-Music/',
    download: 'https://upload.wikimedia.org/wikipedia/commons/d/d6/Charge_-_Concert_Band_-_United_States_Air_Force_Heritage_of_America_Band.mp3',
    sha256: sha256(await readFile(buglePath)) },
  { id: 'whistle', author: 'SpliceSound', license: 'CC0-1.0',
    source: 'https://commons.wikimedia.org/wiki/File:218318_splicesound_referee-whistle-blow-gymnasium.wav',
    originalPage: 'https://freesound.org/people/SpliceSound/sounds/218318/',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    download: 'https://upload.wikimedia.org/wikipedia/commons/7/7d/218318_splicesound_referee-whistle-blow-gymnasium.wav',
    sha256: sha256(await readFile(whistlePath)) },
];
const files = [];
if (sources[0].sha256 !== 'fa717b4e7a572abc24333f26f19543ae1308bd70255e9bd4c7e58a933b16ef01' ||
  sources[1].sha256 !== '6659d56633874aba1b03a1639df8019eef0fe57569ea98159e16d1273041c509')
  throw new Error('Signal input differs from the reviewed instrument recordings');
for (const [file, input, team, filter] of [
  ['friendly-bugle.wav', buglePath, 'friendly', 'atrim=0:10.8,afade=t=in:d=0.015,afade=t=out:st=10.6:d=0.2'],
  ['enemy-whistle.wav', whistlePath, 'enemy', 'atrim=0:0.82,highpass=f=650,lowpass=f=6500,afade=t=in:d=0.008,afade=t=out:st=0.68:d=0.14'],
]) {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', resolve(input), '-af', filter,
    '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
  await writeFile(join(output, file), bytes);
  files.push({ file, team, sourceId: team === 'friendly' ? 'bugle' : 'whistle', bytes: bytes.length, sha256: sha256(bytes),
    processing: filter + '; mono 24kHz PCM16; no synthetic instrument replacement' });
}
await writeFile(join(output, 'source.json'), JSON.stringify({
  sourceKind: 'reviewed-instrument-recordings', license: 'Mixed-Public-Domain-and-CC0',
  source: 'https://commons.wikimedia.org/', sources, files,
  limitations: ['Modern recordings used for game instrument timbre, not verified NRA or IJA historical signals.',
    'Friendly Charge is an American military bugle call, not presented as an authenticated Chinese command melody.',
    'The whistle is a referee whistle recorded indoors, not an original Japanese military recording.'],
}, null, 2) + '\n');
console.log(JSON.stringify({ files: files.map(({ file, bytes }) => ({ file, bytes })) }));
