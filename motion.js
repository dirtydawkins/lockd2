(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("motion-ready");

  document.addEventListener("click", (event) => {
    if (reduceMotion || typeof document.startViewTransition !== "function" || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const image = link?.querySelector("img");
    if (!link || !image || link.target === "_blank" || link.hasAttribute("download")) return;
    try {
      const destination = new URL(link.href, window.location.href);
      const slug = destination.searchParams.get("slug");
      if (destination.origin !== window.location.origin || !destination.pathname.endsWith("/rental.html") || !slug) return;
      const source = new URL(image.currentSrc || image.src, window.location.href);
      if (source.protocol !== "https:" && source.origin !== window.location.origin) return;
      sessionStorage.setItem("lockd:motion:rental-image", JSON.stringify({ slug, src: source.href, createdAt: Date.now() }));
      image.style.viewTransitionName = "lockd-rental-photo";
    } catch { /* Motion is optional; a regular link navigation still works. */ }
  });

  if (window.location.pathname.endsWith("/rental.html")) {
    const placeholder = document.querySelector("#rental-transition-placeholder");
    const image = placeholder?.querySelector("img");
    try {
      const record = JSON.parse(sessionStorage.getItem("lockd:motion:rental-image") || "null");
      sessionStorage.removeItem("lockd:motion:rental-image");
      const slug = new URLSearchParams(window.location.search).get("slug");
      if (typeof document.startViewTransition === "function" && record && record.slug === slug && Date.now() - record.createdAt < 6000 && image) {
        const source = new URL(record.src, window.location.origin);
        if (source.protocol === "https:" || source.origin === window.location.origin) {
          image.src = source.href;
          image.alt = "";
          image.style.viewTransitionName = "lockd-rental-photo";
          placeholder.hidden = false;
        }
      }
    } catch { /* Ignore invalid or unavailable session storage. */ }
  }

  if (!reduceMotion && "IntersectionObserver" in window) {
    const revealSelector = "main > section, .how-step, .owner-process-step, .listing-card, .tech-card, .related-rental-card";
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.dataset.motionReveal = "visible";
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -7% 0px", threshold: 0.08 });

    function prepareReveal(element) {
      if (!(element instanceof HTMLElement) || element.hidden || element.hasAttribute("data-motion-reveal")) return;
      const dynamicCard = element.matches(".listing-card, .tech-card, .related-rental-card");
      const top = element.getBoundingClientRect().top;
      if (dynamicCard || top > window.innerHeight * 0.86) {
        if (dynamicCard) {
          const siblings = element.parentElement ? [...element.parentElement.children] : [];
          const index = Math.max(0, siblings.indexOf(element));
          element.style.setProperty("--motion-delay", `${Math.min(index % 6, 5) * 32}ms`);
        }
        element.dataset.motionReveal = "pending";
        observer.observe(element);
      } else {
        element.dataset.motionReveal = "visible";
      }
    }

    function prepareTree(root) {
      if (root instanceof HTMLElement && root.matches(revealSelector)) prepareReveal(root);
      root.querySelectorAll?.(revealSelector).forEach(prepareReveal);
    }

    prepareTree(document.querySelector("main") || document.body);
    const contentObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) prepareTree(node);
        });
        if (record.type === "attributes" && record.target instanceof HTMLElement && !record.target.hidden) prepareReveal(record.target);
      });
    });
    contentObserver.observe(document.querySelector("main") || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  }

  const parallaxImages = !reduceMotion && !window.matchMedia("(max-width: 760px), (hover: none)").matches
    ? [...document.querySelectorAll(".hero-figure img, .tech-hero-image img, .package-image img")]
    : [];

  if (parallaxImages.length) {
    let frame = 0;
    const updateParallax = () => {
      frame = 0;
      const viewportCenter = window.innerHeight / 2;
      parallaxImages.forEach((image) => {
        const frameElement = image.parentElement;
        if (!frameElement) return;
        const bounds = frameElement.getBoundingClientRect();
        if (bounds.bottom < 0 || bounds.top > window.innerHeight) {
          image.style.setProperty("--motion-parallax-y", "0px");
          return;
        }
        const center = bounds.top + bounds.height / 2;
        const offset = Math.max(-8, Math.min(8, (center - viewportCenter) * -0.016));
        image.style.setProperty("--motion-parallax-y", `${offset.toFixed(1)}px`);
      });
    };
    const scheduleParallax = () => {
      if (!frame) frame = window.requestAnimationFrame(updateParallax);
    };
    window.addEventListener("scroll", scheduleParallax, { passive: true });
    window.addEventListener("resize", scheduleParallax, { passive: true });
    scheduleParallax();
  }
})();
