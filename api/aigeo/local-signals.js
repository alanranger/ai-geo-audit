/**
 * Local Signals API
 * 
 * Fetches real local entity signals from Google Business Profile API.
 * 
 * Returns:
 * - Business locations and addresses
 * - Service areas
 * - NAP (Name, Address, Phone) consistency data
 * - LocalBusiness schema detection (from website scan)
 */

import { getBusinessProfileAccessToken } from './utils.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      source: 'local-signals',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { property } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'local-signals',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Get access token for Business Profile API
    const accessToken = await getBusinessProfileAccessToken();
    
    // Step 1: Get accounts
    const accountsResponse = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!accountsResponse.ok) {
      const errorText = await accountsResponse.text();
      throw new Error(`Failed to fetch accounts: ${errorText}`);
    }
    
    const accountsData = await accountsResponse.json();
    const accounts = accountsData.accounts || [];
    
    if (accounts.length === 0) {
      return res.status(200).json({
        status: 'ok',
        source: 'local-signals',
        params: { property },
        data: {
          localBusinessSchemaPages: 0,
          napConsistencyScore: null,
          knowledgePanelDetected: false,
          serviceAreas: [],
          locations: [],
          notes: 'No Business Profile accounts found. Please set up a Google Business Profile to get local signals data.'
        },
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Step 2: Get locations for the first account (or iterate through all)
    const account = accounts[0];
    const accountName = account.name; // e.g., "accounts/109345350307918860454"
    
    const locationsResponse = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,serviceArea`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    let locations = [];
    let serviceAreas = [];
    let napData = [];
    
    if (locationsResponse.ok) {
      const locationsData = await locationsResponse.json();
      locations = locationsData.locations || [];
      
      // Debug: Log location data to see what we're getting
      if (locations.length > 0) {
        console.log('[Local Signals] First location data:', JSON.stringify(locations[0], null, 2));
      }
      
      // Extract service areas and NAP data
      locations.forEach(location => {
        // Service areas - check both SERVICE_AREA_BUSINESS and places data
        if (location.serviceArea) {
          // Extract from places if available
          if (location.serviceArea.places && location.serviceArea.places.placeInfos) {
            location.serviceArea.places.placeInfos.forEach(place => {
              serviceAreas.push({
                placeName: place.placeName || null,
                placeId: place.placeId || null,
                locationName: location.title || location.name
              });
            });
          }
          // Also check for region-based service area
          else if (location.serviceArea.businessType === 'SERVICE_AREA_BUSINESS' && location.serviceArea.regionCode) {
            serviceAreas.push({
              regionCode: location.serviceArea.regionCode,
              locationName: location.title || location.name
            });
          }
        }
        
        // NAP data (Name, Address, Phone)
        if (location.title || location.storefrontAddress || location.phoneNumbers || location.websiteUri) {
          // Try different phone number formats
          let phone = null;
          if (location.phoneNumbers) {
            if (Array.isArray(location.phoneNumbers) && location.phoneNumbers.length > 0) {
              // Format: [{ phoneNumber: "...", ... }]
              phone = location.phoneNumbers[0].phoneNumber || location.phoneNumbers[0];
            } else if (typeof location.phoneNumbers === 'string') {
              // Format: direct string
              phone = location.phoneNumbers;
            } else if (location.phoneNumbers.phoneNumber) {
              // Format: { phoneNumber: "..." }
              phone = location.phoneNumbers.phoneNumber;
            }
          }
          
          // Also check primaryPhone field
          if (!phone && location.primaryPhone) {
            phone = typeof location.primaryPhone === 'string' 
              ? location.primaryPhone 
              : location.primaryPhone.phoneNumber;
          }
          
          napData.push({
            name: location.title || null,
            address: location.storefrontAddress ? {
              addressLines: location.storefrontAddress.addressLines || [],
              locality: location.storefrontAddress.locality || null,
              administrativeArea: location.storefrontAddress.administrativeArea || null,
              postalCode: location.storefrontAddress.postalCode || null,
              regionCode: location.storefrontAddress.regionCode || null
            } : null,
            phone: phone,
            website: location.websiteUri || null
          });
        }
      });
    } else {
      console.warn('Failed to fetch locations:', await locationsResponse.text());
    }
    
    // Step 3: Calculate NAP consistency score
    // Score based on: Name (30%), Address (40%), Phone (30%)
    // Website is bonus but not required for NAP
    let napConsistencyScore = null;
    if (napData.length > 0) {
      const scores = napData.map(nap => {
        let score = 0;
        if (nap.name) score += 30;
        if (nap.address && nap.address.locality) score += 40; // Address with locality is considered complete
        if (nap.phone) score += 30;
        return score;
      });
      napConsistencyScore = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
    }
    
    // Step 4: LocalBusiness schema detection would require website scanning
    // This is a placeholder - would need to scan the website for LocalBusiness schema
    const localBusinessSchemaPages = 0; // TODO: Implement schema scanning
    
    return res.status(200).json({
      status: 'ok',
      source: 'local-signals',
      params: { property },
      data: {
        localBusinessSchemaPages,
        napConsistencyScore,
        knowledgePanelDetected: locations.length > 0, // If we have locations, likely has knowledge panel
        serviceAreas,
        locations: locations.map(loc => ({
          name: loc.title || loc.name,
          address: loc.storefrontAddress,
          phone: loc.phoneNumbers?.[0]?.phoneNumber,
          website: loc.websiteUri,
          serviceArea: loc.serviceArea
        })),
        accountName: account.accountName,
        accountType: account.type,
        notes: `Fetched ${locations.length} location(s) from Google Business Profile. Service areas: ${serviceAreas.length}.`
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error in local-signals:', error);
    return res.status(500).json({
      status: 'error',
      source: 'local-signals',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

