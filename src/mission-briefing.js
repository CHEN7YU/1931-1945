export const MISSION_BRIEFING_SECONDS = 15;

export function createMissionBriefing(element) {
  const title = element.querySelector('[data-mission-title]'), goals = element.querySelector('[data-mission-goals]');
  const dismiss = element.querySelector('[data-mission-dismiss]');
  if (!title || !goals || !dismiss) throw new Error('Mission briefing requires a title, objective list and dismiss button');
  let expiresAt = null;
  const hide = () => { element.hidden = true; expiresAt = null; };
  const requireTime = now => {
    if (!Number.isFinite(now) || now < 0) throw new RangeError('Mission briefing requires finite simulation time');
  };
  dismiss.addEventListener('click', hide);
  hide();
  return {
    show(campaign, now) {
      requireTime(now);
      if (!campaign?.name || !Array.isArray(campaign.goals) || !campaign.goals.length ||
        campaign.goals.some(goal => typeof goal !== 'string' || !goal))
        throw new Error('Mission briefing requires a named campaign with objectives');
      title.textContent = campaign.name;
      goals.replaceChildren(...campaign.goals.map(goal => {
        const item = element.ownerDocument.createElement('li'); item.textContent = goal; return item;
      }));
      expiresAt = now + MISSION_BRIEFING_SECONDS; element.hidden = false;
    },
    update(now) { requireTime(now); if (expiresAt !== null && now >= expiresAt) hide(); },
    hide,
    dispose() { hide(); dismiss.removeEventListener('click', hide); },
  };
}
