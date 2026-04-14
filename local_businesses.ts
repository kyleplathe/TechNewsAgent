export type LocalBusiness = {
  name: string;
  category: string;
  description: string;
  website?: string;
  tags: string[];
};

/**
 * Daily rotation + storefront URLs for Playwright local-spotlight grabs.
 * Sources: `docs/linden-hills-43rd-upton/README.md` (verify periodically).
 */
const BUSINESSES_43RD_UPTON: LocalBusiness[] = [
  {
    name: 'Martina',
    category: 'Dining',
    description: 'Argentinian-inspired upscale dining and cocktails',
    website: 'https://www.martinarestaurant.com/',
    tags: ['restaurant', 'brunch', 'upscale'],
  },
  {
    name: 'Tilia',
    category: 'Dining',
    description: 'Sophisticated New American neighborhood bistro',
    website: 'https://www.tiliampls.com/',
    tags: ['bistro', 'seasonal', 'award-winning'],
  },
  {
    name: 'The Harriet Brasserie',
    category: 'Dining',
    description: 'Sustainably minded New American fare in a relaxed setting',
    website: 'https://www.lakeharrietbrasserie.com/',
    tags: ['local-sourced', 'brasserie', 'dinner'],
  },
  {
    name: 'Rosalia',
    category: 'Dining',
    description: 'Artisanal wood-fired pizza and Italian-inspired dishes',
    website: 'https://www.rosaliapizza.com/',
    tags: ['pizza', 'casual', 'outdoor-seating'],
  },
  {
    name: 'Picnic | Linden Hills',
    category: 'Dining/Bar',
    description: 'Neighborhood eatery with late-night service on weekends',
    website: 'https://www.picniclindenhills.com/',
    tags: ['bar', 'late-night', 'community'],
  },
  {
    name: 'Jones Coffee',
    category: 'Cafe',
    description: 'Local coffee shop offering morning caffeine and light bites',
    website: 'https://jones.coffee/',
    tags: ['coffee', 'breakfast', 'local-favorite'],
  },
  {
    name: 'Coffee and Tea Limited',
    category: 'Retail/Cafe',
    description: 'Specialty shop for high-quality beans and loose-leaf teas',
    website: 'https://coffeeandtealtd.com/',
    tags: ['specialty-coffee', 'tea', 'retail'],
  },
  {
    name: 'Settergren’s of Linden Hills',
    category: 'Retail',
    description: 'Classic neighborhood hardware and garden supply store',
    website:
      'https://www.acehardware.com/store-details/15367/minneapolis-mn/15367',
    tags: ['hardware', 'tools', 'garden', 'pet-supplies'],
  },
  {
    name: 'Pinwheels and Play Toys',
    category: 'Retail',
    description: 'Curated selection of educational and creative toys',
    website: 'https://www.facebook.com/PinwheelsandPlayToys/',
    tags: ['toys', 'gifts', 'children'],
  },
  {
    name: 'Larue’s',
    category: 'Retail',
    description: 'Boutique clothing store with artistic and colorful fashion',
    website: 'https://www.larues.com/',
    tags: ['apparel', 'boutique', 'accessories'],
  },
  {
    name: 'New Gild Jewelers',
    category: 'Retail/Service',
    description: 'Custom jewelry design and professional repair services',
    website: 'https://www.newgild.com/',
    tags: ['jewelry', 'repair', 'custom-design'],
  },
  {
    name: 'Heart of Tibet & Sky Door',
    category: 'Retail',
    description: 'Cultural goods, traditional crafts, and unique gifts',
    website: 'https://heartoftibet.com/',
    tags: ['gifts', 'cultural', 'artisanal'],
  },
  {
    name: 'SuNu Wellness Center',
    category: 'Health',
    description: 'Holistic health center providing chiropractic and massage',
    website: 'https://www.sunuwellness.com/',
    tags: ['wellness', 'chiropractic', 'massage'],
  },
  {
    name: 'Magnolia Aesthetics & Wellness',
    category: 'Health',
    description: 'Aesthetic treatments and personalized wellness plans',
    website: 'https://www.magnoliaaestheticsandwellnessmn.com/',
    tags: ['aesthetics', 'skincare', 'wellness'],
  },
  {
    name: 'Wedge Linden Hills',
    category: 'Grocery',
    description: 'Community-owned co-op specializing in organic produce',
    website: 'https://wedge.coop/linden-hills/',
    tags: ['grocery', 'organic', 'co-op'],
  },
  {
    name: 'France 44 Cheese & Meat',
    category: 'Specialty Food',
    description: 'Premier destination for artisanal cheese and cured meats',
    website: 'https://www.france44.com/',
    tags: ['charcuterie', 'cheese', 'gourmet'],
  },
  {
    name: 'Linden Hills Law Office',
    category: 'Professional',
    description: 'Neighborhood-based legal assistance and consultation',
    website: 'http://www.lindenhillslawoffice.com/',
    tags: ['legal', 'services', 'professional'],
  },
  {
    name: 'Linden43',
    category: 'Real Estate',
    description: 'Modern mixed-use residential and commercial complex',
    website: 'https://linden43.com/',
    tags: ['apartments', 'mixed-use', 'development'],
  },
  {
    name: 'CMT Janitorial Services',
    category: 'Service',
    description: 'Commercial and residential cleaning and maintenance',
    website: 'https://cmtjanitorial.com/',
    tags: ['cleaning', 'janitorial', 'maintenance'],
  },
  {
    name: 'Learning Services LLC',
    category: 'Education',
    description: 'Academic tutoring and educational support services',
    website: 'https://www.designedtolearn.com/',
    tags: ['tutoring', 'education', 'learning'],
  },
  {
    name: 'Wild Rumpus',
    category: 'Retail',
    description: "Iconic children's bookstore known for its unique atmosphere",
    website: 'https://www.wildrumpusbooks.com/',
    tags: ['books', 'children', 'landmark'],
  },
  {
    name: 'Breadsmith',
    category: 'Bakery',
    description: 'Hearth-baked artisan breads and sweets',
    website: 'https://www.breadsmith.com/',
    tags: ['bakery', 'bread', 'artisan'],
  },
  {
    name: "Sebastian Joe's",
    category: 'Ice Cream / Cafe',
    description: 'Neighborhood ice cream and coffee — early morning hours',
    website: 'https://www.sebastianjoesicecream.com/',
    tags: ['ice-cream', 'coffee', 'breakfast'],
  },
  {
    name: 'Sebesta Apothecary',
    category: 'Retail',
    description: 'Sustainable bath, body, and home cleaning products',
    website: 'https://sebestaapothecary.com/',
    tags: ['apothecary', 'sustainable', 'self-care'],
  },
];

/** Stable daily rotation so the plug doesn’t repeat too often. */
export function pickLocalBusiness(): LocalBusiness {
  const now = new Date();
  const chicagoParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
    .formatToParts(now)
    .reduce<Record<string, number>>((acc, part) => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
        acc[part.type] = parseInt(part.value, 10);
      }
      return acc;
    }, {});
  const y = chicagoParts.year ?? now.getUTCFullYear();
  const m = (chicagoParts.month ?? 1) - 1;
  const d = chicagoParts.day ?? 1;
  const start = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, m, d) - start) / 86_400_000);
  const idx =
    ((dayOfYear % BUSINESSES_43RD_UPTON.length) + BUSINESSES_43RD_UPTON.length) %
    BUSINESSES_43RD_UPTON.length;
  return BUSINESSES_43RD_UPTON[idx]!;
}

export const LOCAL_INTERSECTION_CENTER = '43rd St W & Upton Ave S';

/** Legacy reference for maps/docs — not injected into the daily Gemini prompt (avoid naming extra shops in the close). */
export const LOCAL_EARLY_MORNING_SHOPS =
  "Breadsmith, Jones Coffee, and Sebastian Joe's";
