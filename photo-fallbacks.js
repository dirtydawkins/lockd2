(() => {
  const root = "./assets/photos/";
  const photos = {
    stay: { src: `${root}stay-apartment-studio.jpeg`, alt: "Representative stay category image: compact modern apartment with bed and sitting area", note: "Category reference · listing photo not provided" },
    play: { src: `${root}playstation5-setup.jpeg`, alt: "Representative gaming image: PlayStation console and controller beside a television", note: "Category reference · listing photo not provided" },
    phone: { src: `${root}iphone-pro-burgundy.jpeg`, alt: "Representative phone category image: burgundy triple-camera iPhone", note: "Category reference · listing photo not provided" },
    computer: { src: `${root}gaming-pc-purple-rgb.jpeg`, alt: "Representative computer category image: custom PC tower with purple RGB lighting", note: "Category reference · listing photo not provided" },
    technology: { src: `${root}dual-monitor-gaming-setup.jpeg`, alt: "Representative technology category image: dual-monitor gaming setup", note: "Category reference · listing photo not provided" },
    experience: { src: `${root}kenya-maasai-mara-river-crossing.jpeg`, alt: "Representative experience category image: wildlife crossing a river on safari", note: "Category reference · listing photo not provided" },
  };

  function forListing(listing) {
    const category = String(listing?.market_category || listing?.category || "").toLowerCase();
    const attrs = listing?.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
    const details = [listing?.title, listing?.summary, attrs.brand, attrs.model, attrs.configuration, attrs.specifications]
      .filter(Boolean).join(" ").toLowerCase();
    // Vehicle editorial photos are not vehicle inventory. Never reuse one as
    // the photo for an owner listing; listings must show the actual uploaded car.
    if (category === "stay") return photos.stay;
    if (category === "play" || /playstation|ps5|console|gaming/.test(details) && !/computer|desktop|pc tower/.test(details)) return photos.play;
    if (category === "phone" || /iphone|phone|smartphone/.test(details)) return photos.phone;
    if (category === "computer" || /gaming pc|desktop|computer/.test(details)) return photos.computer;
    if (["technology", "laptop"].includes(category)) return photos.technology;
    if (category === "experience") return photos.experience;
    return null;
  }

  window.LockdPhotoFallbacks = Object.freeze({ forListing });
})();
