import { campaignById } from './campaigns.js';
import { makeTownPreviewLayout, PREVIEW_BRIDGE, PREVIEW_OBJECTIVES } from './town-preview-layout.js';
import { OBJECTIVES } from './core.js';
import { createNanjingObjectives } from './nanjing-campaign.js';
import { sihangObjectives } from './sihang-roster.js';

export function campaignLayout(id) {
  if (campaignById(id).locked) throw new RangeError('Campaign layout unavailable: awaiting the user design brief');
  if (id === 'nanjing') return { campaign: 'nanjing', objectives: createNanjingObjectives() };
  if (id === 'sihang') return { campaign: 'sihang', objectives: sihangObjectives() };
  if (id === 'taierzhuang-streets') return { objectives: OBJECTIVES.map(point => ({ ...point })) };
  return {
    town: makeTownPreviewLayout(),
    bridge: PREVIEW_BRIDGE,
    objectives: PREVIEW_OBJECTIVES.map(({ view, ...point }) => ({ ...point })),
  };
}
