export function createOcclusionQuery() {
  const hits = [];
  return (raycaster, objects, recursive = true) => {
    const ownFirstHit = Object.hasOwn(raycaster, 'firstHitOnly'), previous = raycaster.firstHitOnly;
    raycaster.firstHitOnly = true;
    try {
      for (const object of objects) {
        hits.length = 0;
        raycaster.intersectObject(object, recursive, hits);
        if (hits.length) return true;
      }

      return false;
    } finally {
      hits.length = 0;
      if (ownFirstHit) raycaster.firstHitOnly = previous;
      else delete raycaster.firstHitOnly;
    }
  };
}

export function createClosestHitQuery() {
  const hits = [];
  return (raycaster, objects, recursive = true) => {
    const ownFirstHit = Object.hasOwn(raycaster, 'firstHitOnly'), previous = raycaster.firstHitOnly;
    raycaster.firstHitOnly = true;
    try {
      raycaster.intersectObjects(objects, recursive, hits);
      return hits[0] ?? null;
    } finally {
      hits.length = 0;
      if (ownFirstHit) raycaster.firstHitOnly = previous;
      else delete raycaster.firstHitOnly;
    }
  };
}
