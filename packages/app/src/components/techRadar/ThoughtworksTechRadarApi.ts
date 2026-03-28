import { TechRadarApi } from '@backstage-community/plugin-tech-radar';
import {
  MovedState,
  RadarEntry,
  TechRadarLoaderResponse,
} from '@backstage-community/plugin-tech-radar-common';

const VOLUMES_API =
  'https://api.github.com/repos/setchy/thoughtworks-tech-radar-volumes/contents/volumes/json';

const RADAR_DATE_FALLBACK = new Date('2025-11-01');

interface ThoughtworksBlip {
  name: string;
  ring: string;
  quadrant: string;
  isNew: string;
  status: string;
  description: string;
  relatedBlips: string[];
}

interface GitHubFile {
  name: string;
  download_url: string;
}

// Parse "Thoughtworks Technology Radar Volume 33 (Nov 2025).json"
// → { volume: 33, label: 'Vol. 33 · November 2025', date: Date }
function parseVolumeName(filename: string): { volume: number; label: string; date: Date } | null {
  const m = filename.match(/Volume\s+(\d+)\s+\((\w+)\s+(\d{4})\)/i);
  if (!m) return null;
  const volume = parseInt(m[1], 10);
  const monthStr = m[2];
  const year = parseInt(m[3], 10);
  const date = new Date(`${monthStr} 1, ${year}`);
  const label = `Vol. ${volume} · ${date.toLocaleString('en-US', { month: 'long' })} ${year}`;
  return { volume, label, date };
}

function statusToMoved(status: string, isNew: string): MovedState {
  if (isNew === 'TRUE') return MovedState.NoChange;
  if (status === 'moved in') return MovedState.Up;
  if (status === 'moved out') return MovedState.Down;
  return MovedState.NoChange;
}

function toEntryKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function cleanDescription(html: string): string {
  const stripped = html
    .replace(/<a\s[^>]*>/gi, '')
    .replace(/<\/a>/gi, '')
    .trim()
    .replace(/^"+|"+$/g, '')
    .trim();

  if (!/<p|<ul|<ol|<h[1-6]|<br/i.test(stripped)) {
    return stripped
      .split(/(?<=[.!?])\s{2,}|(?<=[.!?])\s+(?=[A-Z])/)
      .filter(s => s.trim())
      .map(s => `<p>${s.trim()}</p>`)
      .join('\n');
  }

  return stripped;
}

export class ThoughtworksTechRadarApi implements TechRadarApi {
  private _cache: TechRadarLoaderResponse | null = null;
  private _volumeLabel: string = 'Thoughtworks Technology Radar';

  get volumeLabel(): string { return this._volumeLabel; }

  async load(): Promise<TechRadarLoaderResponse> {
    if (this._cache) return this._cache;

    // 1. Find the latest volume from GitHub
    const listRes = await fetch(VOLUMES_API);
    if (!listRes.ok) throw new Error(`Failed to list radar volumes: ${listRes.status}`);

    const files: GitHubFile[] = await listRes.json();
    const volumes = files
      .map(f => ({ ...f, parsed: parseVolumeName(f.name) }))
      .filter(f => f.parsed !== null)
      .sort((a, b) => b.parsed!.volume - a.parsed!.volume);

    if (volumes.length === 0) throw new Error('No radar volumes found');

    const latest = volumes[0];
    this._volumeLabel = `Thoughtworks Technology Radar · ${latest.parsed!.label}`;

    // 2. Fetch the actual blip data
    const dataRes = await fetch(latest.download_url);
    if (!dataRes.ok) throw new Error(`Failed to fetch radar data: ${dataRes.status}`);

    const blips: ThoughtworksBlip[] = await dataRes.json();
    const radarDate = latest.parsed!.date ?? RADAR_DATE_FALLBACK;

    const entries: RadarEntry[] = blips.map(blip => ({
      key: toEntryKey(blip.name),
      id: toEntryKey(blip.name),
      title: blip.name,
      quadrant: blip.quadrant,
      description: cleanDescription(blip.description),
      links: [
        {
          url: `https://www.thoughtworks.com/radar/${blip.quadrant}/${toEntryKey(blip.name)}`,
          title: 'View on Thoughtworks Radar',
        },
      ],
      timeline: [
        {
          ringId: blip.ring,
          date: radarDate,
          moved: statusToMoved(blip.status, blip.isNew),
          description: blip.status,
        },
      ],
    }));

    this._cache = {
      quadrants: [
        { id: 'languages-and-frameworks', name: 'Languages & Frameworks' },
        { id: 'platforms', name: 'Platforms' },
        { id: 'techniques', name: 'Techniques' },
        { id: 'tools', name: 'Tools' },
      ],
      rings: [
        { id: 'adopt', name: 'ADOPT', color: '#43a047', description: 'We strongly recommend this technology. Use it when appropriate.' },
        { id: 'trial', name: 'TRIAL', color: '#1976d2', description: 'Worth pursuing. Understand how to build this capability.' },
        { id: 'assess', name: 'ASSESS', color: '#fb8c00', description: 'Worth exploring to understand how it will affect your enterprise.' },
        { id: 'hold', name: 'HOLD', color: '#e53935', description: 'Proceed with caution.' },
      ],
      entries,
    };

    return this._cache;
  }
}
