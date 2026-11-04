export function createCampaignPresentation(doc = document) {
  const menu = doc.getElementById('menu'), menuWall = doc.getElementById('menu-photo-wall');
  const loadingWall = doc.getElementById('loading-photo-wall');
  const previews = [...doc.querySelectorAll('[data-campaign-preview]')];
  const deployment = doc.getElementById('deployment-campaign-context');
  if (!menu || !menuWall || !loadingWall || !deployment || previews.length !== 2)
    throw new Error('Campaign presentation requires menu, loading and deployment previews');
  const failures = new Set(), images = [...doc.querySelectorAll('[data-campaign-image]')];
  for (const image of images) {
    image.onload = () => {
      image.hidden = false;
      image.parentElement.querySelector('[data-campaign-image-status]').hidden = true;
    };
    image.onerror = () => {
      image.hidden = true;
      const status = image.parentElement.querySelector('[data-campaign-image-status]');
      status.textContent = '战场预览暂时无法加载，仍可继续出击。'; status.hidden = false;
      if (!failures.has(image.src)) { failures.add(image.src); console.error(`Campaign preview failed: ${image.src}`); }
    };
  }
  const reset = () => {
    delete menu.dataset.campaignSelected;
    menuWall.hidden = loadingWall.hidden = false;
    for (const preview of previews) preview.hidden = true;
    deployment.hidden = true;
  };
  reset();
  return {
    reset,
    select(campaign) {
      if (!campaign?.preview?.src || !campaign.preview.alt || !Array.isArray(campaign.goals) || !campaign.goals.length)
        throw new Error('Selected campaign requires its own image and objectives');
      menu.dataset.campaignSelected = campaign.id;
      menuWall.hidden = loadingWall.hidden = true;
      for (const preview of previews) preview.hidden = false;
      for (const image of images) {
        image.hidden = false; image.alt = campaign.preview.alt;
        image.src = campaign.preview.src;
        image.parentElement.querySelector('[data-campaign-image-status]').hidden = true;
      }
      for (const name of doc.querySelectorAll('[data-campaign-name]')) name.textContent = campaign.name;
      for (const goals of doc.querySelectorAll('[data-campaign-goals]')) goals.replaceChildren(...campaign.goals.map(goal => {
        const item = doc.createElement('li'); item.textContent = goal; return item;
      }));
    },
    dispose() { for (const image of images) image.onerror = image.onload = null; },
  };
}
