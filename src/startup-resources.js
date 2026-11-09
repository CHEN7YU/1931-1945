export const RESOURCE_MODES = Object.freeze(['auto', 'standard', 'low-memory']);

export function startupResourceProfile(mode, deviceMemory = null) {
  if (!RESOURCE_MODES.includes(mode)) throw new RangeError('Unknown startup resource mode');
  if (deviceMemory !== null && (!Number.isFinite(deviceMemory) || deviceMemory <= 0))
    throw new RangeError('Invalid reported device memory');
  const lowMemory = mode === 'low-memory' || mode === 'auto' && deviceMemory !== null && deviceMemory <= 4;
  return Object.freeze({ mode, lowMemory, textureLimit: lowMemory ? 512 : Infinity,
    atlasTile: lowMemory ? 256 : 512, motionPhases: lowMemory ? 4 : 6,
    supportPitches: lowMemory ? 3 : 5, detailedActors: lowMemory ? 2 : 6 });
}

export function createStartupTextureBudget(profile, { createCanvas = () => document.createElement('canvas') } = {}) {
  const seen = new WeakSet(), queue = [];
  const stats = { textures: 0, resized: 0, sourceTexels: 0, residentTexels: 0, peakConcurrentLoads: 0 };
  const concurrency = profile.lowMemory ? 2 : Infinity;
  let active = 0;
  const acquire = () => {
    if (active < concurrency) {
      active++; stats.peakConcurrentLoads = Math.max(stats.peakConcurrentLoads, active);
      return Promise.resolve();
    }
    return new Promise(resolve => queue.push(resolve));
  };
  const release = () => {
    if (queue.length) queue.shift()();
    else active--;
  };
  function resize(texture) {
    if (seen.has(texture)) return texture;
    const image = texture.image, width = image?.naturalWidth || image?.width, height = image?.naturalHeight || image?.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
      throw new Error('Loaded resource texture has no valid image dimensions');
    seen.add(texture); stats.textures++; stats.sourceTexels += width * height;
    const factor = Math.min(1, profile.textureLimit / Math.max(width, height));
    if (factor === 1) { stats.residentTexels += width * height; return texture; }
    const canvas = createCanvas();
    canvas.width = Math.max(1, Math.round(width * factor)); canvas.height = Math.max(1, Math.round(height * factor));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Low-memory texture resizing requires a 2D canvas');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    texture.image = canvas; texture.needsUpdate = true;
    image.close?.();
    stats.resized++; stats.residentTexels += canvas.width * canvas.height;
    return texture;
  }
  return {
    resize,
    async load(loader, url) {
      await acquire();
      try { return resize(await loader.loadAsync(url)); }
      finally { release(); }
    },
    get snapshot() { return { ...stats, activeLoads: active, queuedLoads: queue.length, textureLimit: profile.textureLimit }; },
  };
}
