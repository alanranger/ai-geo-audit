/** Paused ChatGPT Ads. Display only. Not cover, pipeline, or still to find. */

export const CHATGPT_ADS_REPORTED = { clicks: 201, spend_gbp: 455 };

export const CHATGPT_ADS_PLAN = {
  state: 'PAUSED',
  since: '19 Nov 07:11',
  ends: '2 Dec 13:00',
  total_cap: '£500',
  tracking: 'Paused. Own tracking: 1 trial, 0 orders. OpenAI recorded 0 conversions.',
  spend_note: '£455 invoiced (+ £91 VAT = £546 paid). Provider hourly £454.35 / 201 clicks. Provider reports disagree (aggregate £188.19 / 82 clicks), under query with OpenAI. Earlier snapshot: £188.19 / 82 clicks.',
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
      clicks: row.provider_clicks == null ? CHATGPT_ADS_REPORTED.clicks : Number(row.provider_clicks),
      spend_gbp: row.provider_spend == null ? CHATGPT_ADS_REPORTED.spend_gbp : Number(row.provider_spend)
    }
  };
}
