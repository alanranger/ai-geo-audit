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
 * - GBP rating and review count (with static fallback)
 */

import { getBusinessProfileAccessToken } from './utils.js';
import fs from 'fs';
import path from 'path';

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
    
    console.log('[Local Signals] Fetching locations for account:', accountName);
    
    // Business Profile API readMask - use valid field names
    // Note: primaryPhone might not be a valid field, and phoneNumbers might need to be requested differently
    const locationsUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,serviceArea`;
    console.log('[Local Signals] Locations URL:', locationsUrl);
    
    const locationsResponse = await fetch(locationsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('[Local Signals] Locations response status:', locationsResponse.status);
    
    let locations = [];
    let serviceAreas = [];
    let napData = [];
    let locationsToProcess = []; // Initialize to avoid undefined errors
    
    if (locationsResponse.ok) {
      const locationsData = await locationsResponse.json();
      console.log('[Local Signals] Locations response data:', JSON.stringify(locationsData, null, 2));
      locations = locationsData.locations || [];
      console.log('[Local Signals] Found', locations.length, 'locations');
      
      // Fetch detailed information for each location (phone numbers might be in details)
      const locationDetails = [];
      for (const location of locations) {
        try {
          // Get full location details with all fields
          const locationDetailUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${location.name}?readMask=*`;
          console.log('[Local Signals] Fetching location details:', locationDetailUrl);
          
          const detailResponse = await fetch(locationDetailUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            console.log('[Local Signals] Location detail data:', JSON.stringify(detailData, null, 2));
            locationDetails.push(detailData);
          } else {
            console.warn('[Local Signals] Failed to get location details:', await detailResponse.text());
            locationDetails.push(location); // Fall back to basic location data
          }
          
          // Fetch rating and review count for this location
          // Note: This might require a different endpoint or be included in the detail response
          try {
            const reviewsUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${location.name}`;
            // Rating and review count might be in the location detail, or we might need a reviews endpoint
            // For now, check if it's in the detailData we already fetched
          } catch (error) {
            console.warn('[Local Signals] Could not fetch reviews:', error);
          }
        } catch (error) {
          console.error('[Local Signals] Error fetching location details:', error);
          locationDetails.push(location); // Fall back to basic location data
        }
      }
      
      // Use detailed location data if available, otherwise use basic
      locationsToProcess = locationDetails.length > 0 ? locationDetails : locations;
      
      // Debug: Log location data to see what we're getting
      if (locationsToProcess.length > 0) {
        console.log('[Local Signals] First location data (full):', JSON.stringify(locationsToProcess[0], null, 2));
      }
      
      // Extract rating and review count from location details
      // Note: The Business Information API may not include rating/review count in location details
      // We need to check the actual response structure or use a different endpoint
      let gbpRating = null;
      let gbpReviewCount = null;
      
      if (locationsToProcess.length > 0) {
        const firstLocation = locationsToProcess[0];
        
        // Check various possible field names for rating and review count in the location detail
        // The Business Information API might have these fields nested or named differently
        gbpRating = firstLocation.rating 
          || firstLocation.averageRating 
          || firstLocation.primaryRating 
          || (firstLocation.primaryCategory && firstLocation.primaryCategory.rating)
          || (firstLocation.moreHours && firstLocation.moreHours.rating)
          || null;
          
        gbpReviewCount = firstLocation.totalReviewCount 
          || firstLocation.reviewCount 
          || firstLocation.numberOfReviews
          || (firstLocation.primaryCategory && firstLocation.primaryCategory.totalReviewCount)
          || null;
        
        // If not found in detail, try fetching from the Reviews API endpoint
        if ((gbpRating === null || gbpReviewCount === null) && firstLocation.name) {
          try {
            // Try the Reviews API endpoint: accounts/{account}/locations/{location}/reviews
            // This endpoint requires different permissions and may return review data
            const reviewsUrl = `https://mybusiness.googleapis.com/v4/${firstLocation.name}/reviews`;
            console.log('[Local Signals] Attempting to fetch reviews from:', reviewsUrl);
            
            const reviewsResponse = await fetch(reviewsUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            });
            
            if (reviewsResponse.ok) {
              const reviewsData = await reviewsResponse.json();
              console.log('[Local Signals] Reviews API response:', JSON.stringify(reviewsData, null, 2));
              
              // Extract rating and review count from reviews response
              // The structure might be: { reviews: [...], averageRating: X, totalReviewCount: Y }
              if (reviewsData.averageRating !== undefined) {
                gbpRating = reviewsData.averageRating;
              }
              if (reviewsData.totalReviewCount !== undefined) {
                gbpReviewCount = reviewsData.totalReviewCount;
              } else if (reviewsData.reviews && Array.isArray(reviewsData.reviews)) {
                // If we have the reviews array, calculate from it
                gbpReviewCount = reviewsData.reviews.length;
                if (reviewsData.reviews.length > 0) {
                  const sumRating = reviewsData.reviews.reduce((sum, review) => sum + (review.starRating || 0), 0);
                  gbpRating = sumRating / reviewsData.reviews.length;
                }
              }
            } else {
              const errorText = await reviewsResponse.text();
              console.log('[Local Signals] Reviews API not available or requires different permissions:', reviewsResponse.status, errorText);
            }
          } catch (error) {
            console.warn('[Local Signals] Could not fetch rating/review count from Reviews API:', error.message);
          }
        }
        
        console.log('[Local Signals] GBP Rating:', gbpRating, 'Review Count:', gbpReviewCount);
      }
      
      // Fallback to static JSON file if API didn't return rating/review count
      if ((gbpRating === null || gbpRating === 0) || (gbpReviewCount === null || gbpReviewCount === 0)) {
        try {
          const gbpReviewsPath = path.join(process.cwd(), 'data', 'gbp-reviews.json');
          const gbpReviewsContent = fs.readFileSync(gbpReviewsPath, 'utf8');
          const gbpReviews = JSON.parse(gbpReviewsContent);
          
          if (gbpReviews.gbpRating && (gbpRating === null || gbpRating === 0)) {
            gbpRating = parseFloat(gbpReviews.gbpRating);
            console.log('[Local Signals] Using GBP rating from fallback file:', gbpRating);
          }
          if (gbpReviews.gbpReviewCount && (gbpReviewCount === null || gbpReviewCount === 0)) {
            gbpReviewCount = parseInt(gbpReviews.gbpReviewCount);
            console.log('[Local Signals] Using GBP review count from fallback file:', gbpReviewCount);
          }
        } catch (fileError) {
          console.warn('[Local Signals] Could not read gbp-reviews.json fallback file:', fileError.message);
        }
      }
      
      // Extract service areas and NAP data
      locationsToProcess.forEach(location => {
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
            // Check for primaryPhone nested inside phoneNumbers object
            if (location.phoneNumbers.primaryPhone) {
              phone = location.phoneNumbers.primaryPhone;
            }
            // Check for array format: [{ phoneNumber: "...", ... }]
            else if (Array.isArray(location.phoneNumbers) && location.phoneNumbers.length > 0) {
              phone = location.phoneNumbers[0].phoneNumber || location.phoneNumbers[0];
            }
            // Check for direct string
            else if (typeof location.phoneNumbers === 'string') {
              phone = location.phoneNumbers;
            }
            // Check for { phoneNumber: "..." } format
            else if (location.phoneNumbers.phoneNumber) {
              phone = location.phoneNumbers.phoneNumber;
            }
          }
          
          // Also check primaryPhone field at location level
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
      const errorText = await locationsResponse.text();
      console.error('[Local Signals] Failed to fetch locations. Status:', locationsResponse.status);
      console.error('[Local Signals] Error response:', errorText);
      
      // Try to parse error for better logging
      try {
        const errorData = JSON.parse(errorText);
        console.error('[Local Signals] Parsed error:', JSON.stringify(errorData, null, 2));
      } catch (e) {
        console.error('[Local Signals] Error text (not JSON):', errorText);
      }
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
        // GBP Rating and Review Count (for Review Score calculation)
        gbpRating: gbpRating !== null ? parseFloat(gbpRating) : null,
        gbpReviewCount: gbpReviewCount !== null ? parseInt(gbpReviewCount) : null,
        locations: locationsToProcess.map(loc => {
          // Extract phone number with all possible formats
          let phone = null;
          if (loc.phoneNumbers) {
            // Check for primaryPhone nested inside phoneNumbers object (THIS IS THE FORMAT!)
            if (loc.phoneNumbers.primaryPhone) {
              phone = loc.phoneNumbers.primaryPhone;
            }
            // Check for array format: [{ phoneNumber: "...", ... }]
            else if (Array.isArray(loc.phoneNumbers) && loc.phoneNumbers.length > 0) {
              phone = loc.phoneNumbers[0].phoneNumber || loc.phoneNumbers[0];
            }
            // Check for direct string
            else if (typeof loc.phoneNumbers === 'string') {
              phone = loc.phoneNumbers;
            }
            // Check for { phoneNumber: "..." } format
            else if (loc.phoneNumbers.phoneNumber) {
              phone = loc.phoneNumbers.phoneNumber;
            }
          }
          if (!phone && loc.primaryPhone) {
            phone = typeof loc.primaryPhone === 'string' 
              ? loc.primaryPhone 
              : loc.primaryPhone.phoneNumber;
          }
          
          return {
            name: loc.title || loc.name,
            address: loc.storefrontAddress,
            phone: phone,
            phoneNumbersRaw: loc.phoneNumbers, // Include raw data for debugging
            primaryPhoneRaw: loc.primaryPhone, // Include raw data for debugging
            website: loc.websiteUri,
            serviceArea: loc.serviceArea,
            // Include all fields for debugging
            _debug: {
              hasPhoneNumbers: !!loc.phoneNumbers,
              hasPrimaryPhone: !!loc.primaryPhone,
              phoneNumbersType: typeof loc.phoneNumbers,
              allKeys: Object.keys(loc).filter(k => k.toLowerCase().includes('phone'))
            }
          };
        }),
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

