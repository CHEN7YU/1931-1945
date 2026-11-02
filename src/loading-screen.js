import metadata from '../public/assets/loading/source.json' with { type: 'json' };

export const LOADING_PHOTOS = Object.freeze(metadata.files.map(file => {
  const image = file.restored ?? file;
  return Object.freeze({
    src: `/assets/loading/${image.file}`,
    alt: file.restored ? `${file.alt}（AI修复上色，非历史原色）` : file.alt,
    width: image.width, height: image.height, restored: Boolean(file.restored),
  });
}));
export const PHOTO_WALL_SPEED = 72;
// Display-only bottom trims; preserve original images and their provenance.
export const PHOTO_WALL_BOTTOM_TRIMS = Object.freeze({
  'photo-14': .07, 'photo-15': .065, 'photo-18': .095, 'photo-19': .10,
  'photo-20': .075, 'photo-21': .14, 'photo-22': .065,
});

export function createPhotoWall(element, {
  document: doc = document, Observer = MutationObserver, Resize = ResizeObserver,
  photos = LOADING_PHOTOS, visibilityElement = element,
  reducedMotion = doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)'),
} = {}) {
  const track = element.querySelector('[data-photo-wall-track]');
  const status = element.querySelector('[data-photo-wall-status]');
  const toggle = element.querySelector('[data-photo-wall-toggle]');
  if (!track || !status || !toggle || !photos.length ||
    photos.some(photo => !photo.src || !photo.alt || !(photo.width > 0) || !(photo.height > 0))) {
    throw new Error('Photo wall requires its track, controls and valid photos');
  }
  let paused = reducedMotion?.matches ?? false, disposed = false;
  if (photos.some(photo => photo.restored)) status.textContent = '部分影像经AI修复上色，颜色与补全细节为推测，非历史原色。';
  const failures = new Set();
  const copies = [false, true].map(duplicate => {
    const copy = doc.createElement('div'); copy.className = 'photo-wall-copy';
    if (duplicate) copy.setAttribute('aria-hidden', 'true');
    for (const photo of photos) {
      const card = doc.createElement('figure'), image = doc.createElement('img');
      card.className = 'photo-wall-card';
      const name = photo.src.split('/').at(-1).replace(/\.[^.]+$/, '');
      const trim = PHOTO_WALL_BOTTOM_TRIMS[name] ?? 0;
      if (trim) {
        card.classList.add('photo-wall-trimmed');
        card.style.setProperty('--photo-trim-ratio', String(photo.width / (photo.height * (1 - trim))));
        card.style.setProperty('--photo-trim-scale', String(1 / (1 - trim)));
      }
      image.alt = photo.alt; image.width = photo.width; image.height = photo.height; image.decoding = 'async';
      image.onerror = () => {
        if (disposed) return;
        card.classList.add('unavailable');
        const caption = doc.createElement('figcaption'); caption.textContent = '影像暂不可用'; card.append(caption);
        status.textContent = '部分影像未能加载，游戏仍可继续。';
        if (!failures.has(photo.src)) {
          failures.add(photo.src); console.error(`Photo wall image failed: ${photo.src}`);
        }
      };
      image.src = photo.src; card.append(image); copy.append(card);
    }
    return copy;
  });
  track.replaceChildren(...copies); track.setAttribute('data-ready', '');
  const updateSpeed = () => {
    const width = copies[0].getBoundingClientRect().width;
    if (width > 0) track.style.setProperty('--photo-wall-duration', `${width / PHOTO_WALL_SPEED}s`);
  };
  const sync = () => {
    updateSpeed();
    track.style.animationPlayState = !disposed && !paused && !visibilityElement.hidden && !doc.hidden ? 'running' : 'paused';
    toggle.textContent = paused ? '继续滚动' : '暂停滚动';
    toggle.setAttribute('aria-pressed', String(paused));
  };
  const onToggle = () => { paused = !paused; sync(); };
  const onMotionChange = event => { paused = event.matches; sync(); };
  toggle.addEventListener('click', onToggle);
  doc.addEventListener('visibilitychange', sync);
  reducedMotion?.addEventListener('change', onMotionChange);
  const observer = new Observer(sync), resize = new Resize(updateSpeed);
  observer.observe(visibilityElement, { attributes: true, attributeFilter: ['hidden'] });
  resize.observe(copies[0]);
  sync();
  return {
    dispose() {
      disposed = true; sync(); observer.disconnect(); resize.disconnect();
      toggle.removeEventListener('click', onToggle); doc.removeEventListener('visibilitychange', sync);
      reducedMotion?.removeEventListener('change', onMotionChange);
      for (const copy of copies) for (const image of copy.querySelectorAll('img')) image.onerror = null;
    },
  };
}
