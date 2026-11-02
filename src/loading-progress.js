export function setLoadingProgress(percent, message, doc = document) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError('Loading progress must be an integer from 0 to 100');
  }
  const bar = doc.getElementById('loading-progress');
  const label = doc.getElementById('loading-percentage');
  const status = doc.getElementById('loading-message');
  if (!bar || !label || !status) throw new Error('Loading progress requires its bar, percentage and status');
  bar.value = percent;
  bar.textContent = label.textContent = `${percent}%`;
  bar.setAttribute('aria-valuetext', `${percent}%`);
  status.textContent = message;
}
