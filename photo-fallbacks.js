(() => {
  const root = "./assets/photos/";
  const photos = {
    stay: { src: `${root}stay-apartment-studio.jpeg`, alt: "Representative stay category image: compact modern apartment with bed and sitting area", note: "Category reference · listing photo not provided" },
    drive: { src: `${root}mercedes-g-class-sand.jpeg`, alt: "Representative Drive category image: beige Mercedes-Benz G-Class", note: "Category reference · listing photo not provided" },
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
    if (category === "drive") {
      if (/maybach/.test(details)) return { src: `${root}mercedes-maybach-sedan.jpeg`, alt: "Representative car image: Mercedes-Maybach sedan", note: "Representative vehicle · listing photo not provided" };
      if (/gle/.test(details)) return { src: `${root}mercedes-amg-gle.jpeg`, alt: "Representative car image: burgundy Mercedes-AMG GLE Coupe", note: "Representative vehicle · listing photo not provided" };
      if (/x7/.test(details)) return { src: `${root}bmw-x7-black.jpeg`, alt: "Representative car image: black BMW X7", note: "Representative vehicle · listing photo not provided" };
      if (/\bxm\b/.test(details)) return { src: `${root}bmw-xm-black.jpeg`, alt: "Representative car image: black BMW XM", note: "Representative vehicle · listing photo not provided" };
      if (/tesla|electric sedan/.test(details)) return { src: `${root}tesla-electric-sedan.jpeg`, alt: "Representative car image: dark electric sedan", note: "Representative vehicle · listing photo not provided" };
      if (/bmw/.test(details) && /coupe|m[ -]?style/.test(details)) return { src: `${root}bmw-performance-coupe-red-front.jpeg`, alt: "Representative car image: red BMW performance coupe", note: "Representative vehicle · listing photo not provided" };
      return photos.drive;
    }
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
