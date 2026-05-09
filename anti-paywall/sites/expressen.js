initSite({
  overlaySelectors: [
    // Existing paywall overlay selectors
    '#tapet-paywall',
    '.bn-tapet',
    '.tapet-paywall',
    '.paywall-manager__fallback',
    
    // Premium article links - remove the link element itself
    'a.premium-link',
    'a.slider__item.premium-link',
    
    // Premium icons - remove the icon elements
    '.premium-icon',
  ],
  fixBodyScroll: true,
});
