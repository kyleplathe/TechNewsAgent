export type LocalBusiness = {
  name: string;
  category: string;
  description: string;
  website?: string;
  tags: string[];
};

/**
 * Daily rotation + storefront URLs for Playwright local-spotlight grabs.
 * Full Linden Hills Neighborhood Council directory (all sections used for listings, except elected Representatives).
 * Source of truth: https://www.lindenhills.org/directory
 */
const LINDEN_HILLS_DIRECTORY_BUSINESSES: LocalBusiness[] = [
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
    website: 'https://instakyle.tech/',
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
  {
    name: 'Bde Maka Ska Park',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/parks-destinations/parks-lakes/bde_maka_ska_park/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Bde Maka Ska Thomas Beach',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/activities-events/water-activities/beaches/bde_maka_ska_thomas_beach/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: "Beard's Plaisance",
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/parks-destinations/parks-lakes/beards_plaisance/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Como-Harriet Streetcar Line',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://trolleyride.org/como-harriet-streetcar/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Lake Harriet Park & Bandshell',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/parks-destinations/parks-lakes/lake_harriet_park/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Lake Harriet North Beach',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/activities-events/water-activities/beaches/lake_harriet_north_beach/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Lake Harriet Yacht Club',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://lhycsailing.com/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Linden Hills Park & Recreation Center',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/parks-destinations/parks-lakes/linden_hills_park/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Roberts Bird Sanctuary',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/parks-destinations/parks-lakes/roberts_bird_sanctuary/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Twin Cities Sailing Club',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://tcsailing.org/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Waveland Triangle',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/parks-destinations/parks-lakes/triangles__other_tiny_parks/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Wheel Fun Rentals - Lake Harriet',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://wheelfunrentals.com/mn/minneapolis/lake-harriet/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'William Berry Park',
    category: 'Recreation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website:
      'https://www.minneapolisparks.org/parks-destinations/parks-lakes/william_berry_park/',
    tags: ['recreation', 'linden-hills'],
  },
  {
    name: 'Freemasons of Lake Harriet Lodge',
    category: 'Faith & Spirituality',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.lakeharrietlodge.org/',
    tags: ['faith-spirituality', 'linden-hills'],
  },
  {
    name: 'Lake Harriet Spiritual Community',
    category: 'Faith & Spirituality',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://lakeharrietspiritualcommunity.org/',
    tags: ['faith-spirituality', 'linden-hills'],
  },
  {
    name: 'Minneapolis Friends Meeting (Quakers)',
    category: 'Faith & Spirituality',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://minneapolisfriends.org/',
    tags: ['faith-spirituality', 'linden-hills'],
  },
  {
    name: "St. John's Episcopal Church",
    category: 'Faith & Spirituality',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://stjohns-mpls.org/',
    tags: ['faith-spirituality', 'linden-hills'],
  },
  {
    name: 'St. Thomas the Apostle',
    category: 'Faith & Spirituality',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.stthomasmpls.org/',
    tags: ['faith-spirituality', 'linden-hills'],
  },
  {
    name: 'Third Church of Christ, Scientist',
    category: 'Faith & Spirituality',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://thirdchurchminneapolis.org/',
    tags: ['faith-spirituality', 'linden-hills'],
  },
  {
    name: 'True Apostolic Assembly',
    category: 'Faith & Spirituality',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['faith-spirituality', 'linden-hills'],
  },
  {
    name: 'Lake Harriet Community Schools',
    category: 'Education & Childcare',
    description:
      'Listed in the Linden Hills Neighborhood Council directory (lower and upper campuses).',
    website: 'https://lakeharriet.mpschools.org/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Anthony Middle School',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://anthony.mpschools.org/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Southwest High School',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://southwest.mpschools.org/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Carondelet Catholic School',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.carondelet-mpls.org/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'The Forest School of Minnesota',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.forestschoolmn.org/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Girasol Montessori School',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.girasolmontessorimn.com/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Linden Hills Child Care',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'http://www.lindenhillschildcare.com/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Minneapolis Kids',
    category: 'Education & Childcare',
    description:
      'Listed in the Linden Hills Neighborhood Council directory (before & after school, summer, and non-school day programming).',
    website: 'https://ce.mpschools.org/youth/mpls-kids',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Minneapolis Kids Jr at Lake Harriet Lower',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://ce.mpschools.org/youth/mpls-kids/mpls-kids-jr',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Southwest KinderCare',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Linden Hills Library',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.hclib.org/about/locations/linden-hills/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Minneapolis Community Education',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://ce.mpschools.org/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Linden Hills Recreation Center',
    category: 'Education & Childcare',
    description:
      'Listed in the Linden Hills Neighborhood Council directory (programs; same campus as neighborhood recreation center).',
    website:
      'https://anc.apm.activecommunities.com/mplsparkandrec/activity/search?onlineSiteId=0&activity_select_param=2&center_ids=27&viewMode=list',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'rit. Learning & Consulting & grrit.y kids podcast',
    category: 'Education & Childcare',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.ritlearns.com/',
    tags: ['education-and-childcare', 'linden-hills'],
  },
  {
    name: 'Metro Transit',
    category: 'Transportation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.metrotransit.org/',
    tags: ['transportation', 'linden-hills'],
  },
  {
    name: 'Metro Mobility',
    category: 'Transportation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.metrotransit.org/metro-mobility',
    tags: ['transportation', 'linden-hills'],
  },
  {
    name: 'Bicycling (City of Minneapolis)',
    category: 'Transportation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.minneapolismn.gov/getting-around/bicycles/',
    tags: ['transportation', 'linden-hills'],
  },
  {
    name: 'Scooters (City of Minneapolis)',
    category: 'Transportation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    website: 'https://www.minneapolismn.gov/getting-around/scooters/',
    tags: ['transportation', 'linden-hills'],
  },
  {
    name: 'Rideshare & Taxis',
    category: 'Transportation',
    description: 'Listed in the Linden Hills Neighborhood Council directory.',
    tags: ['transportation', 'linden-hills'],
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
  /** Prefer directory entries with a storefront URL so email / bundle artifacts always get a Local Spotlight link when possible. */
  const pool = LINDEN_HILLS_DIRECTORY_BUSINESSES.filter((b) =>
    b.website?.trim()
  ) as LocalBusiness[];
  const rotation =
    pool.length > 0
      ? pool
      : (LINDEN_HILLS_DIRECTORY_BUSINESSES as LocalBusiness[]);
  const idx =
    ((dayOfYear % rotation.length) + rotation.length) % rotation.length;
  return rotation[idx]!;
}

export const LOCAL_INTERSECTION_CENTER = '43rd St W & Upton Ave S';

/** Legacy reference for maps/docs — not injected into the daily Gemini prompt (avoid naming extra shops in the close). */
export const LOCAL_EARLY_MORNING_SHOPS =
  "Breadsmith, Jones Coffee, and Sebastian Joe's";
