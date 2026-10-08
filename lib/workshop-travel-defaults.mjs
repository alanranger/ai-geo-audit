/**
 * Editable travel / mileage defaults for per-event GP (Strategy §E).
 * Merged into booking_sheet_workshop_cost_model.locations + rates.
 */

export const DEFAULT_MILEAGE_RATES = {
  fuel_price_per_litre: 1.8,
  mpg: 40,
  wear_per_mile: 0.15,
  day_food: 10
};

/** Seed locations: match via keywords against title / location_name. Base = CV4 9HW. */
export const DEFAULT_TRAVEL_LOCATIONS = [
  { name: 'Kenilworth', keywords: ['crackley', 'kenilworth'], one_way_miles: 4, one_way_drive_h: 0.2 },
  { name: 'Piles Coppice', keywords: ['piles', 'binley', 'coventry walk'], one_way_miles: 6, one_way_drive_h: 0.33 },
  { name: 'Coventry city', keywords: ['urban', 'coventry evening'], one_way_miles: 4, one_way_drive_h: 0.25 },
  { name: 'Warwickshire Christmas walk', keywords: ['warwickshire christmas'], one_way_miles: 7, one_way_drive_h: 0.25 },
  { name: 'Leamington', keywords: ['christmas evening', 'leamington'], one_way_miles: 9, one_way_drive_h: 0.33 },
  { name: 'Hay Woods / Solihull', keywords: ['hay woods', 'solihull'], one_way_miles: 10, one_way_drive_h: 0.33 },
  { name: 'Bluebells', keywords: ['bluebell'], one_way_miles: 12, one_way_drive_h: 0.42 },
  { name: 'Chesterton Windmill', keywords: ['chesterton'], one_way_miles: 12, one_way_drive_h: 0.33 },
  { name: 'Batsford Arboretum', keywords: ['batsford'], one_way_miles: 33, one_way_drive_h: 0.83 },
  { name: 'Lavender', keywords: ['lavender', 'gloucestershire'], one_way_miles: 35, one_way_drive_h: 0.92 },
  { name: 'Upper Hulme / Roaches', keywords: ['upper hulme', 'roaches', 'heathers'], one_way_miles: 75, one_way_drive_h: 1.67 },
  { name: 'Padley Gorge / Peak District', keywords: ['padley', 'peak district'], one_way_miles: 95, one_way_drive_h: 2 },
  { name: 'Burnham-on-Sea', keywords: ['burnham'], one_way_miles: 125, one_way_drive_h: 2.25 },
  { name: 'Fairy Glen / Betws-y-Coed', keywords: ['fairy glen', 'betws'], one_way_miles: 135, one_way_drive_h: 2.75 },
  { name: 'Lake Vyrnwy / Pistyll Rhaeadr', keywords: ['vyrnwy', 'vyrnw', 'pistyll', 'rhaeadr'], one_way_miles: 110, one_way_drive_h: 2.5, local_miles_per_day: 40 },
  { name: 'Norfolk', keywords: ['norfolk', 'cromer', 'hunstanton'], one_way_miles: 150, one_way_drive_h: 3.25, local_miles_per_day: 60 },
  { name: 'Dorset', keywords: ['dorset', 'purbeck', 'jurassic'], one_way_miles: 150, one_way_drive_h: 3.25, local_miles_per_day: 50 },
  { name: 'Yorkshire Dales', keywords: ['yorkshire dales', 'yorkshire'], one_way_miles: 150, one_way_drive_h: 3, local_miles_per_day: 50 },
  { name: 'Anglesey / Menai', keywords: ['anglesey', 'menai'], one_way_miles: 160, one_way_drive_h: 3.25, local_miles_per_day: 40 },
  { name: 'Suffolk', keywords: ['suffolk'], one_way_miles: 165, one_way_drive_h: 3.5, local_miles_per_day: 40 },
  { name: 'Dartmoor', keywords: ['dartmoor'], one_way_miles: 190, one_way_drive_h: 3.5, local_miles_per_day: 40 },
  { name: 'Lake District', keywords: ['lake district', 'cumbria'], one_way_miles: 200, one_way_drive_h: 3.75, local_miles_per_day: 50 },
  { name: 'Hartland Quay', keywords: ['hartland'], one_way_miles: 210, one_way_drive_h: 4, local_miles_per_day: 40 },
  {
    name: 'Home',
    keywords: [
      'secrets of woodland', 'woodland masterclass',
      'garden photography', 'abstract', 'macro', 'home studio'
    ],
    one_way_miles: 0,
    one_way_drive_h: 0
  }
];

export function costPerMile(rates = {}) {
  const fuel = Number(rates.fuel_price_per_litre ?? DEFAULT_MILEAGE_RATES.fuel_price_per_litre);
  const mpg = Number(rates.mpg ?? DEFAULT_MILEAGE_RATES.mpg) || 40;
  const wear = Number(rates.wear_per_mile ?? DEFAULT_MILEAGE_RATES.wear_per_mile);
  return (fuel * 4.546) / mpg + wear;
}

/** Merge travel defaults into a persisted Workshop Costs model (room rates kept). */
export function mergeTravelIntoCostModel(model) {
  const sheetLocs = model?.locations || [];
  const rates = {
    ...(model?.rates || {}),
    ...DEFAULT_MILEAGE_RATES,
    ...(model?.rates || {})
  };
  // Drop retired hard-coded day defaults if present
  delete rates.day_hours;
  delete rates.day_petrol;
  delete rates.petrol_per_day;

  const locations = DEFAULT_TRAVEL_LOCATIONS.map((t) => {
    const room = sheetLocs.find((s) => {
      const sn = String(s.name || '').toLowerCase();
      return (t.keywords || []).some((k) => sn.includes(String(k).toLowerCase()))
        || sn.includes(String(t.name).toLowerCase().split('/')[0].trim());
    });
    return {
      ...t,
      roomRate: room?.roomRate != null ? Number(room.roomRate) : (t.roomRate || 0)
    };
  });
  return { ...model, rates, locations, travel_seeded: true };
}
