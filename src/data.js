
// ============================================================================
// EXISTING CRM DATA (Used by existing features)
// ============================================================================
export const featuredAds = [
  { id: 1, title: 'High Speed Internet', image: 'img/ads/internet.jpg', link: 'https://bbnl.co.in/' },
  { id: 2, title: 'Wi‑Fi Mesh Offer', image: 'img/ads/wifi.jpg', link: 'https://bbnl.co.in/' },
  { id: 3, title: 'IPTV All-In-One', image: 'img/ads/iptv.jpg', link: 'https://promotions.bbnl.in/' },
  { id: 4, title: '24x7 Support', image: 'img/ads/customer care.jpg', link: '#' }
]

export const transactions = [
  { id: 1, name: 'Vidhya Shree S', desc: 'Internet Renewal (FTTH-100Mbps)', amount: '- ₹150', avatar: 'img/user/user1.jpg' },
  { id: 2, name: 'Santhosh Kumar', desc: 'OTT Subscription (Watcho_BBNPL 1_3M)', amount: '- ₹29', avatar: 'img/user/user2.jpg' },
  { id: 3, name: 'Operator', desc: 'Transfer', amount: '+ ₹1,000', avatar: 'img/user/user3.jpg' },
  { id: 4, name: 'Mohammed Sadiq', desc: 'IPTV Subscription (ALL_IN_ONE_GOLD)', amount: '- ₹186', avatar: 'img/user/user4.jpg' }
]

// ============================================================================
// MOCK DATA FOR NEW SERVICE FEATURES ONLY
// ============================================================================
// NOTE: Customer data (name, email, phone) comes from API (getCustList)
// Only service-specific details below are mocked for new features:
// - FoFi Smart Box, Voice, Internet, IPTV service details
// ============================================================================

// FoFi Smart Box Plans
export const fofiPlans = [
  {
    id: 'fta-only-basic',
    name: 'FTA Basic',
    type: 'FTA-only',
    price: 99,
    validity: '30 days',
    features: ['100+ Free-to-Air channels', 'HD Quality', 'No subscription required', 'One-time activation']
  },
  {
    id: 'fta-only-premium',
    name: 'FTA Premium',
    type: 'FTA-only',
    price: 149,
    validity: '30 days',
    features: ['150+ Free-to-Air channels', 'Full HD Quality', 'No subscription required', 'Premium FTA content']
  },
  {
    id: 'fta-dpo-starter',
    name: 'FTA + DPO Starter',
    type: 'FTA + DPO',
    price: 249,
    validity: '30 days',
    features: ['100+ FTA channels', '150+ Premium DPO channels', 'HD Quality', 'Sports & Entertainment']
  },
  {
    id: 'fta-dpo-premium',
    name: 'FTA + DPO Premium',
    type: 'FTA + DPO',
    price: 399,
    validity: '30 days',
    features: ['150+ FTA channels', '300+ Premium DPO channels', 'Full HD Quality', 'All Sports, Movies & Entertainment']
  }
]

// Voice Plans
export const voicePlans = [
  {
    id: 'unlimited-calling',
    name: 'UNLIMITED CALLING',
    price: 100,
    validity: '30 days',
    features: ['Unlimited local & STD calls', 'Crystal clear voice quality', '24x7 support'],
    isSpecialOffer: true
  }
]

// IPTV FTA Base Packs (Mandatory selection)
export const iptvFTABasePacks = [
  {
    id: 'fta-basic',
    name: 'FTA Basic Pack',
    price: 0,
    channels: 120,
    description: 'Free-to-Air basic channels'
  },
  {
    id: 'fta-super-saver',
    name: 'FTA SUPER SAVER PACK',
    price: 153,
    channels: 180,
    description: 'Enhanced FTA package with premium free channels'
  },
  {
    id: 'fta-premium',
    name: 'FTA Premium Pack',
    price: 99,
    channels: 150,
    description: 'Premium FTA channels collection'
  }
]

// IPTV Add-on Packages
export const iptvAddonPackages = [
  {
    id: 'nto3-disney-kids-2',
    name: 'NTO3 Disney Kids Pack(2)',
    price: 17.00,
    channels: 2,
    description: 'Disney kids entertainment'
  },
  {
    id: 'nto3-disney-kids-1d-1',
    name: 'NTO3 Disney Kids 1D(1)',
    price: 20.00,
    channels: 1,
    description: 'Disney premium kids channel'
  },
  {
    id: 'nto3-etv-family',
    name: 'NTO3 ETV Family',
    price: 31.00,
    channels: 5,
    description: 'ETV family entertainment pack'
  },
  {
    id: 'nto3-happy-india-pack-1',
    name: 'NTO3 HAPPY INDIA Pack 1(7)',
    price: 57.00,
    channels: 7,
    description: 'Happy India entertainment bundle'
  },
  {
    id: 'nto3-happy-india-english-2',
    name: 'NTO3 HAPPY INDIA ENGLISH DELIGHT 2 (N3)',
    price: 13.00,
    channels: 3,
    description: 'English entertainment channels'
  }
]

// IPTV A-la-carte Channels
export const iptvAlacarteChannels = [
  { id: 'star-sports-1', name: 'Star Sports 1 HD', price: 19.00, category: 'Sports' },
  { id: 'star-sports-2', name: 'Star Sports 2 HD', price: 19.00, category: 'Sports' },
  { id: 'sony-hd', name: 'Sony HD', price: 19.00, category: 'Entertainment' },
  { id: 'zee-tv-hd', name: 'Zee TV HD', price: 19.00, category: 'Entertainment' },
  { id: 'colors-hd', name: 'Colors HD', price: 19.00, category: 'Entertainment' },
  { id: 'discovery-hd', name: 'Discovery HD', price: 8.00, category: 'Infotainment' },
  { id: 'nat-geo-hd', name: 'National Geographic HD', price: 8.00, category: 'Infotainment' },
  { id: 'mtv-hd', name: 'MTV HD', price: 6.00, category: 'Music' },
  { id: 'vh1-hd', name: 'VH1 HD', price: 6.00, category: 'Music' },
  { id: 'nick-hd', name: 'Nickelodeon HD', price: 12.00, category: 'Kids' }
]

// Mock Customer Service Subscriptions
export const mockCustomerServices = {
  'testus1': {
    customerId: 'testus1',
    name: 'MohanRaj',
    mobile: '8433544736',
    email: 'dghddh@email.com',
    services: {
      internet: {
        active: true,
        internetId: 'testus1',
        planName: '300MB_Tripleplay',
        expiryDate: '2026-03-14T11:59:59',
        serviceName: 'internet'
      },
      voice: {
        active: true,
        planId: 'unlimited-calling',
        planName: 'UNLIMITED CALLING',
        price: 100,
        expiryDate: '2026-02-28T23:59:59'
      },
      fofi: {
        active: true,
        planName: 'FTA+SUPER SAVER PACK',
        planId: 'fta-dpo-starter',
        expiryDate: '2026-01-16T11:59:59',
        deviceInfo: {
          unicastId: 'UC123456789',
          multicastId: 'MC987654321',
          fofiBoxId: 'A43EA0A01F4A'
        }
      },
      iptv: {
        active: true,
        planName: 'FTA+SUPER SAVER PACK',
        basePack: 'fta-super-saver',
        expiryDate: '2026-01-16T11:59:59',
        fofiBoxId: 'A43EA0A01F4A',
        addons: ['nto3-disney-kids-2'],
        channels: ['star-sports-1', 'sony-hd']
      }
    }
  },
  'customer2': {
    customerId: 'customer2',
    name: 'Rajesh Kumar',
    mobile: '9876543210',
    email: 'rajesh@email.com',
    services: {
      internet: {
        active: true,
        internetId: 'customer2',
        planName: '500MB_Premium',
        expiryDate: '2026-02-20T11:59:59',
        serviceName: 'internet'
      },
      voice: {
        active: false
      },
      fofi: {
        active: false
      },
      iptv: {
        active: false
      }
    }
  },
  'lgiptv': {
    customerId: 'lgiptv',
    name: 'bharathkumar',
    mobile: '9025606600',
    email: 'bhkm@email.com',
    services: {
      internet: {
        active: true,
        internetId: 'lgiptv',
        planName: '300MB_Tripleplay',
        expiryDate: '2026-03-14T11:59:59',
        serviceName: 'internet'
      },
      voice: {
        active: true,
        planId: 'unlimited-calling',
        planName: 'UNLIMITED CALLING',
        price: 100,
        expiryDate: '2026-02-28T23:59:59'
      },
      fofi: {
        active: true,
        planName: 'FTA+SUPER SAVER PACK',
        planId: 'fta-dpo-starter',
        expiryDate: '2026-01-16T11:59:59',
        deviceInfo: {
          unicastId: 'UC123456789',
          multicastId: 'MC987654321',
          fofiBoxId: 'A43EA0A01F4A'
        }
      },
      iptv: {
        active: true,
        planName: 'FTA+SUPER SAVER PACK',
        basePack: 'fta-super-saver',
        expiryDate: '2026-01-16T11:59:59',
        fofiBoxId: 'A43EA0A01F4A',
        addons: ['nto3-disney-kids-2'],
        channels: ['star-sports-1', 'sony-hd']
      }
    }
  }
}

// Device validation mock data
export const mockDeviceDatabase = {
  'SN123456': { macAddress: 'AA:BB:CC:DD:EE:FF', status: 'available' },
  'SN789012': { macAddress: '11:22:33:44:55:66', status: 'available' },
  'SN345678': { macAddress: 'FF:EE:DD:CC:BB:AA', status: 'in-use' }
}
