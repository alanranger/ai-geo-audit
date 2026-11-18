/** Live ChatGPT Ads. Display only. Not cover, pipeline, or still to find. */

export const CHATGPT_ADS_PLAN = {
  state: 'LIVE',
  since: '18 Nov 18:45',
  ends: '2 Dec 13:00',
  total_cap: '£500',
  tracking: 'Own tracking proven · OpenAI Pixel live (awaiting first real event) · GA4 purchase tag fixed (v23)',
  campaigns: [
    {
      name: 'Gifts & Academy',
      id: 'cmpn_5dfb74726ce481a289954d70a1b11b11',
      cap: '£400',
      state: 'LIVE',
      ads: '6 ads: 3 gift vouchers, 3 Academy. All provider-approved.'
    },
    {
      name: 'Short Workshops UK capped test',
      id: 'cmpn_036167a3656081988ef33a74f1201ffe',
      cap: '£100',
      state: 'LIVE',
      ads: '8 location ads, each to its own booking page. All provider-approved.',
      locations: [
        'Bluebells (Warwickshire)',
        'Chesterton Windmill',
        'Coventry woodland masterclass',
        'Warwickshire macro',
        'Kenilworth Castle',
        'Peak District',
        'Burnham-on-Sea',
        'Fairy Glen (March date sold out and left off)'
      ],
      held: '3 earlier generic workshop ads are not in the launch set. They stay paused and are not deleted.'
    }
  ]
};

export function chatgptAdsView(summary) {
  const row = summary || {};
  return {
    ok: true,
    ...CHATGPT_ADS_PLAN,
    figures: {
      visits: Number(row.sessions || 0),
      purchases: Number(row.purchases || 0),
      revenue_gbp: Number(row.revenue_gbp || 0),
      trials: Number(row.trials || 0),
      clicks: row.provider_clicks == null ? null : Number(row.provider_clicks),
      spend_gbp: row.provider_spend == null ? null : Number(row.provider_spend)
    }
  };
}
