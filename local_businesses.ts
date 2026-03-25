export type LocalBusiness = {
  name: string;
  category: string;
  description: string;
  tags: string[];
};

const BUSINESSES_43RD_UPTON: LocalBusiness[] = [
  {
    name: 'Martina',
    category: 'Dining',
    description: 'Argentinian-inspired upscale dining and cocktails',
    tags: ['restaurant', 'brunch', 'upscale'],
  },
  {
    name: 'Tilia',
    category: 'Dining',
    description: 'Sophisticated New American neighborhood bistro',
    tags: ['bistro', 'seasonal', 'award-winning'],
  },
  {
    name: 'The Harriet Brasserie',
    category: 'Dining',
    description: 'Sustainably minded New American fare in a relaxed setting',
    tags: ['local-sourced', 'brasserie', 'dinner'],
  },
  {
    name: 'Rosalia',
    category: 'Dining',
    description: 'Artisanal wood-fired pizza and Italian-inspired dishes',
    tags: ['pizza', 'casual', 'outdoor-seating'],
  },
  {
    name: 'Picnic | Linden Hills',
    category: 'Dining/Bar',
    description: 'Neighborhood eatery with late-night service on weekends',
    tags: ['bar', 'late-night', 'community'],
  },
  {
    name: 'Jones Coffee',
    category: 'Cafe',
    description: 'Local coffee shop offering morning caffeine and light bites',
    tags: ['coffee', 'breakfast', 'local-favorite'],
  },
  {
    name: 'Coffee and Tea Limited',
    category: 'Retail/Cafe',
    description: 'Specialty shop for high-quality beans and loose-leaf teas',
    tags: ['specialty-coffee', 'tea', 'retail'],
  },
  {
    name: 'Settergren’s of Linden Hills',
    category: 'Retail',
    description: 'Classic neighborhood hardware and garden supply store',
    tags: ['hardware', 'tools', 'garden', 'pet-supplies'],
  },
  {
    name: 'Pinwheels and Play Toys',
    category: 'Retail',
    description: 'Curated selection of educational and creative toys',
    tags: ['toys', 'gifts', 'children'],
  },
  {
    name: 'Larue’s',
    category: 'Retail',
    description: 'Boutique clothing store with artistic and colorful fashion',
    tags: ['apparel', 'boutique', 'accessories'],
  },
  {
    name: 'New Gild Jewelers',
    category: 'Retail/Service',
    description: 'Custom jewelry design and professional repair services',
    tags: ['jewelry', 'repair', 'custom-design'],
  },
  {
    name: 'Heart of Tibet & Sky Door',
    category: 'Retail',
    description: 'Cultural goods, traditional crafts, and unique gifts',
    tags: ['gifts', 'cultural', 'artisanal'],
  },
  {
    name: 'SuNu Wellness Center',
    category: 'Health',
    description: 'Holistic health center providing chiropractic and massage',
    tags: ['wellness', 'chiropractic', 'massage'],
  },
  {
    name: 'Magnolia Aesthetics & Wellness',
    category: 'Health',
    description: 'Aesthetic treatments and personalized wellness plans',
    tags: ['aesthetics', 'skincare', 'wellness'],
  },
  {
    name: 'Wedge Linden Hills',
    category: 'Grocery',
    description: 'Community-owned co-op specializing in organic produce',
    tags: ['grocery', 'organic', 'co-op'],
  },
  {
    name: 'France 44 Cheese & Meat',
    category: 'Specialty Food',
    description: 'Premier destination for artisanal cheese and cured meats',
    tags: ['charcuterie', 'cheese', 'gourmet'],
  },
  {
    name: 'Linden Hills Law Office',
    category: 'Professional',
    description: 'Neighborhood-based legal assistance and consultation',
    tags: ['legal', 'services', 'professional'],
  },
  {
    name: 'Linden43',
    category: 'Real Estate',
    description: 'Modern mixed-use residential and commercial complex',
    tags: ['apartments', 'mixed-use', 'development'],
  },
  {
    name: 'CMT Janitorial Services',
    category: 'Service',
    description: 'Commercial and residential cleaning and maintenance',
    tags: ['cleaning', 'janitorial', 'maintenance'],
  },
  {
    name: 'Learning Services LLC',
    category: 'Education',
    description: 'Academic tutoring and educational support services',
    tags: ['tutoring', 'education', 'learning'],
  },
  {
    name: 'Wild Rumpus',
    category: 'Retail',
    description: "Iconic children's bookstore known for its unique atmosphere",
    tags: ['books', 'children', 'landmark'],
  },
  {
    name: 'Breadsmith',
    category: 'Bakery',
    description: 'Hearth-baked artisan breads and sweets',
    tags: ['bakery', 'bread', 'artisan'],
  },
  {
    name: 'Sebesta Apothecary',
    category: 'Retail',
    description: 'Sustainable bath, body, and home cleaning products',
    tags: ['apothecary', 'sustainable', 'self-care'],
  },
];

/** Stable daily rotation so the plug doesn’t repeat too often. */
export function pickLocalBusiness(): LocalBusiness {
  const today = new Date();
  const y = today.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, today.getUTCMonth(), today.getUTCDate()) - start) / 86_400_000);
  const idx = ((dayOfYear % BUSINESSES_43RD_UPTON.length) + BUSINESSES_43RD_UPTON.length) % BUSINESSES_43RD_UPTON.length;
  return BUSINESSES_43RD_UPTON[idx]!;
}

export const LOCAL_INTERSECTION_CENTER = '43rd St W & Upton Ave S';
