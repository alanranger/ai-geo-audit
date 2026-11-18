/** Paused ChatGPT Ads test. Display only. Not cover, pipeline, or still to find. */

export const CHATGPT_ADS_PLAN = {
  total_cap: '£500',
  credit_deadline: '2 Dec 2026 13:48 UK',
  campaigns: [
    {
      name: 'Gifts & Academy',
      id: 'cmpn_5dfb74726ce481a289954d70a1b11b11',
      cap: '£400',
      state: 'PAUSED',
      ads: '6 ads: 3 gift vouchers, 3 Academy. All provider-approved.'
    },
    {
      name: 'Short Workshops UK capped test',
      id: 'cmpn_036167a3656081988ef33a74f1201ffe',
      cap: '£100',
      state: 'PAUSED',
      ads: 'Launch set: 8 location ads, each to its own booking page.',
      locations: [
        'Bluebells (Warwickshire)',
        'Chesterton Windmill',
        'Coventry woodland masterclass',
        'Warwickshire macro',
        'Kenilworth Castle',
        'Peak District',
        'Burnham-on-Sea (provider review)',
        'Fairy Glen (provider review; March date sold out and left off)'
      ],
      held: '3 earlier generic workshop ads are not in the launch set. They stay paused and are not deleted.'
    }
  ]
};

export function chatgptAdsView(ordersProven) {
  const proven = ordersProven === true;
  const blockers = [
    proven ? null : 'Order tracking proof',
    'Flight end date',
    'Dynamic creative setting',
    "Alan's final launch approval"
  ].filter(Boolean);
  return {
    ok: true,
    ...CHATGPT_ADS_PLAN,
    tracking: `Tracking: Academy proven · Orders ${proven ? 'proven' : 'not proven'}`,
    blockers
  };
}
