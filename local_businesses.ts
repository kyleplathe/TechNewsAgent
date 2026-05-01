export type LocalBusiness = {
  name: string;
  category: string;
  description: string;
  website?: string;
  tags: string[];
};

/**
 * Daily rotation + storefront URLs for Playwright local-spotlight grabs.
 * Source of truth: https://www.lindenhills.org/directory
 */
const BUSINESSES_43RD_UPTON: LocalBusiness[] = [
  {
    name: 'Caphin Minneapolis',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Coffee and Tea Limited',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://coffeeandtealtd.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'France 44',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.france44.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Great Harvest Bread Company',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Great Wall Chinese Restaurant',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'The Harriet Brasserie',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.lakeharrietbrasserie.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Jones Coffee Linden Hills',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://jones.coffee/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Le Burger 4304',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Linden Hills Farmers Market',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Martina',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.martinarestaurant.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: "Naviya's Thai Kitchen",
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Old Southern BBQ',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Picnic Linden Hills',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.picniclindenhills.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Rosalia Pizza',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.rosaliapizza.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: "Sebastian Joe's Linden Hills",
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.sebastianjoesicecream.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Tilia',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.tiliampls.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Tosca',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Turtle Bread Co.',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.turtlebread.com/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Wedge Co-op Linden Hills',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://wedge.coop/linden-hills/',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Wooden Ship Brewing',
    category: 'Food & Beverage',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['food-and-beverage', 'linden-hills'],
  },
  {
    name: 'Brown & Greene Floral',
    category: 'Home, Decor & Garden',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['home-decor-and-garden', 'linden-hills'],
  },
  {
    name: 'Everett & Charlie Art Gallery',
    category: 'Home, Decor & Garden',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['home-decor-and-garden', 'linden-hills'],
  },
  {
    name: 'Harriann Upholstery',
    category: 'Home, Decor & Garden',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['home-decor-and-garden', 'linden-hills'],
  },
  {
    name: "Settergren's Ace Hardware",
    category: 'Home, Decor & Garden',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.acehardware.com/store-details/15367/minneapolis-mn/15367',
    tags: ['home-decor-and-garden', 'linden-hills'],
  },
  {
    name: 'Sunnyside Gardens',
    category: 'Home, Decor & Garden',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['home-decor-and-garden', 'linden-hills'],
  },
  {
    name: 'Victory Vintage',
    category: 'Home, Decor & Garden',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['home-decor-and-garden', 'linden-hills'],
  },
  {
    name: 'Yardware',
    category: 'Home, Decor & Garden',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['home-decor-and-garden', 'linden-hills'],
  },
  {
    name: "Andrea's Vintage Bridal",
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Comma, a bookshop',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Heart of Tibet & Sky Door',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://heartoftibet.com/',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Instakyle Tech Solutions LLC',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: "Larue's",
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.larues.com/',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Linden Hills Bike Shop',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Linden Hills Jewelers',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Pinwheels and Play Toys',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'New Gild Jewelers',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.newgild.com/',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Wild Rumpus',
    category: 'Other Retail',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.wildrumpusbooks.com/',
    tags: ['other-retail', 'linden-hills'],
  },
  {
    name: 'Associated Skin Care Specialist Minneapolis',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Bold North Mental Health Services',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Bruley Center',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Buzz Barbers',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Clear Day Counseling',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Devanadi School of Yoga & Wellness',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Fundamental Strength',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Julia Clowney, LICSW',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Life in Light Chiropractic',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Linden Hills Dentistry',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Loon State Physical Therapy',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Magnolia Acupuncture',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Magnolia Aesthetics & Wellness',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.magnoliaaestheticsandwellnessmn.com/',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Michele Terese Beauty',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Mint Orthodontics',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Nail Images',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Owl Optical',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Peterbuilt Fitness',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Sage Education & Therapy',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Salon Sparrow',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Sauna Strong',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Shayla Boger Skin Therapy',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Stephanie Thaler, LMT',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'SuNu Wellness Center',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.sunuwellness.com/',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Suzanne Harman, LICSW',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Thai Yoga Bodywork',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Waning Moon Wellness',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'YogaFit Linden Hills',
    category: 'Health, Wellness & Beauty',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['health-wellness-and-beauty', 'linden-hills'],
  },
  {
    name: 'Fox Homes',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'Joy Architecture',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'Rehkamp Larson Architects',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'Sticks and Stones Design, Inc.',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'Sunnyside Gardens Landscaping',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'Sustainable 9',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'TEA2 Architects',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'Trestle Homes',
    category: 'Architecture & Design',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['architecture-and-design', 'linden-hills'],
  },
  {
    name: 'Allenson Family Law',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Annie Marie Photography',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Artful Events and Design',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Bame Financial Group',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Centered Wealth',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Dunrite Automotive',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Growing Edge Facilitation',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'House of Music',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Hub 44 Coworking & Common Space',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Jeff Meyer State Farm Insurance',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'JumperCable Marketing',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Lake Harriet Law Office',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Linden Hills Law Office',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'http://www.lindenhillslawoffice.com/',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Linden Hills Writers Group',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'MMC Consulting',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Mosborg Exposures',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Nelson Wealth Planning',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Prestige Cleaning Center',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Rise and Shine and Partners',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
  },
  {
    name: 'Westgate Pet Clinic',
    category: 'Services',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['services', 'linden-hills'],
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
