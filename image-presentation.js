/* Shared framing for authentic photos. Orientation is measured, never guessed
   from a filename. Focal points are explicit owner/editorial metadata, not AI. */
(function (root) {
  const products = new Set(['technology', 'play', 'phone', 'laptop', 'camera', 'audio', 'creative', 'drive']);
  function presentation(record = {}, index = 0) {
    const metadata = record.attributes?.image_presentation?.[index] || {};
    const isProduct = products.has(record.category) || ['gaming','phones','computers','creator','audio','work','accessories'].includes(record.market_category);
    const fit = isProduct ? 'contain' : metadata.fit === 'contain' ? 'contain' : 'cover';
    const validPoint = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
    const focal = validPoint(metadata.focal_x) && validPoint(metadata.focal_y)
      ? `${metadata.focal_x}% ${metadata.focal_y}%` : '50% 50%';
    return { fit, focal };
  }
  if (typeof module === 'object' && module.exports) module.exports = { presentation };
  if (!root.document) return;
  const observed = new WeakSet();
  const sources = new WeakMap();
  const reduced = () => root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function localAsset(image) {
    try {
      const url = new URL(image.getAttribute('src'), location.href);
      return url.origin === location.origin ? root.LockdImageAssets?.[decodeURIComponent(url.pathname.slice(1))] : null;
    } catch { return null; }
  }
  function frame(image) {
    if (!image.getAttribute('src')) return;
    const source = image.getAttribute('src');
    const changed = sources.get(image) !== source;
    sources.set(image, source);
    image.dataset.lockdImage = '';
    image.decoding = 'async';
    if (changed) {
      image.dataset.imageState = 'loading';
      // Remove our old responsive candidates when a gallery changes its source.
      if (image.dataset.responsiveSource && image.dataset.responsiveSource !== source) {
        image.removeAttribute('srcset');
        delete image.dataset.responsiveSource;
      }
    }
    const asset = localAsset(image);
    if (asset) {
      image.width = asset.width; image.height = asset.height;
      if (!image.hasAttribute('srcset') && asset.srcset) {
        image.srcset = asset.srcset;
        image.dataset.responsiveSource = source;
      }
    }
    if (!image.hasAttribute('sizes')) image.sizes = '(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw';
    if (!image.dataset.imageFit) {
      const category = image.closest('[data-category]')?.dataset.category;
      image.dataset.imageFit = products.has(category) || image.closest('.tech-card, .tech-mini-card, .tech-photo-card, .tech-hero-image, .tech-preview-images, .vehicle-reference-card, .vehicle-hero-image, .owner-photo, .owner-preview-content') ? 'contain' : 'cover';
    }
    if (image.complete && image.naturalWidth) loaded(image);
  }
  function loaded(image) {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) return;
    // Intrinsic dimensions improve stability outside fixed card stages as well.
    // Responsive variants have the same ratio; use original dimensions if known.
    const asset = localAsset(image);
    image.width = asset?.width || width; image.height = asset?.height || height;
    image.dataset.orientation = width / height > 1.15 ? 'landscape' : width / height < .87 ? 'portrait' : 'square';
    image.style.setProperty('--photo-ratio', `${width} / ${height}`);
    const alreadyLoaded = image.dataset.imageState === 'loaded';
    image.dataset.imageState = 'loaded';
    if (!alreadyLoaded && !reduced() && image.getBoundingClientRect().top < innerHeight) {
      image.animate?.([{opacity:.75}, {opacity:1}], {duration:360,easing:'cubic-bezier(.22,.68,0,1)'});
    }
  }
  function prepare(image) {
    if (!(image instanceof HTMLImageElement) || image.closest('.brand, .brand-mark')) return;
    if (!observed.has(image)) {
      observed.add(image);
      image.addEventListener('load', () => loaded(image));
      image.addEventListener('error', () => {
        image.dataset.imageState = 'error';
        // Keep the reserved stage and truthful alt text; never substitute inventory.
        image.alt = `Photograph unavailable${image.alt ? ` — ${image.alt.replace(/^Photograph unavailable — /, '')}` : ''}`;
      });
    }
    frame(image);
  }
  function configure(image, record, index = 0) {
    const meta = presentation(record, index);
    image.dataset.imageFit = meta.fit;
    image.style.setProperty('--photo-position', meta.focal);
    prepare(image);
    return image;
  }
  function scan(node) {
    if (node instanceof HTMLImageElement) prepare(node);
    node.querySelectorAll?.('img').forEach(prepare);
  }
  scan(document);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') prepare(record.target);
      else record.addedNodes.forEach(scan);
    }
  });
  observer.observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  root.addEventListener('pagehide', () => observer.disconnect(), {once:true});
  root.addEventListener('pageshow', event => {if(event.persisted) {scan(document);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});}});
  root.LockdImages = Object.freeze({configure, presentation});
})(typeof window === 'undefined' ? {} : window);
