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
import fs from 'fs/promises';
import path from 'path';

function normalizePropertyUrl(value) {
  if (!value || typeof value !== 'string') return null;
  let raw = value.trim();
  if (!raw) return null;
  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return raw;
  }
}

async function updateSupabaseGbp(propertyUrl, gbpRating, gbpReviewCount) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;
    if (gbpRating == null || gbpReviewCount == null) return;

    const normalizedProperty = normalizePropertyUrl(propertyUrl);
    if (!normalizedProperty) return;

    const latestUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(normalizedProperty)}&select=audit_date&order=audit_date.desc&limit=1`;
    const latestRes = await fetch(latestUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!latestRes.ok) return;
    const latestRows = await latestRes.json().catch(() => []);
    const latest = Array.isArray(latestRows) && latestRows.length > 0 ? latestRows[0] : null;
    if (!latest?.audit_date) return;

    const updateUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(normalizedProperty)}&audit_date=eq.${latest.audit_date}`;
    await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        gbp_rating: gbpRating,
        gbp_review_count: gbpReviewCount
      })
    });
  } catch (e) {
    console.warn('[Local Signals] Failed to update Supabase GBP values:', e?.message || String(e));
  }
}

async function readGbpFallback() {
  try {
    const gbpReviewsPath = path.join(process.cwd(), 'data', 'gbp-reviews.json');
    const gbpReviewsContent = await fs.readFile(gbpReviewsPath, 'utf8');
    const gbpReviews = JSON.parse(gbpReviewsContent);

    const rating = Number(gbpReviews.gbpRating || gbpReviews.rating);
    const count = Number(gbpReviews.gbpReviewCount || gbpReviews.reviewCount || gbpReviews.count);

    if (Number.isFinite(rating) && rating > 0 && Number.isFinite(count) && count > 0) {
      return { gbpRating: rating, gbpReviewCount: count };
    }

    console.warn('[Local Signals] Fallback file is missing rating or count', gbpReviews);
    return { gbpRating: null, gbpReviewCount: null };
  } catch (fileError) {
    console.error('[Local Signals] Could not read gbp-reviews.json fallback file:', fileError.message);
    return { gbpRating: null, gbpReviewCount: null };
  }
}

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
    // Note: rating and reviewCount are NOT available in the locations LIST endpoint
    // They can only be fetched from individual location DETAIL endpoints
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
    let gbpRating = null; // Declare at top level so fallback can access it
    let gbpReviewCount = null; // Declare at top level so fallback can access it
    let nextPageToken = null; // Declare at top level for pagination and debug info
    let locationsResponseStatus = locationsResponse.status; // Store status for debug info
    
    if (locationsResponse.ok) {
      const locationsData = await locationsResponse.json();
      console.log('[Local Signals] Locations response data:', JSON.stringify(locationsData, null, 2));
      
      // Check for locations in various possible response structures
      locations = locationsData.locations || locationsData.location || [];
      
      // If locations is not an array, try to extract it
      if (!Array.isArray(locations)) {
        if (locationsData.locations && Array.isArray(locationsData.locations)) {
          locations = locationsData.locations;
        } else if (locationsData.location && Array.isArray(locationsData.location)) {
          locations = locationsData.location;
        } else {
          console.warn('[Local Signals] Locations data is not an array:', typeof locations, locations);
          locations = [];
        }
      }
      
      console.log('[Local Signals] Found', locations.length, 'locations');
      
      // Check for pagination
      nextPageToken = locationsData.nextPageToken;
      if (nextPageToken) {
        console.log('[Local Signals] ⚠️ Response has nextPageToken - locations are paginated!');
        console.log('[Local Signals] nextPageToken:', nextPageToken);
        console.log('[Local Signals] Fetching additional pages...');
        
        // Fetch all pages
        while (nextPageToken) {
          const paginatedUrl = `${locationsUrl}&pageToken=${encodeURIComponent(nextPageToken)}`;
          console.log('[Local Signals] Fetching page:', paginatedUrl);
          
          const paginatedResponse = await fetch(paginatedUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (paginatedResponse.ok) {
            const paginatedData = await paginatedResponse.json();
            const additionalLocations = paginatedData.locations || [];
            console.log('[Local Signals] Found', additionalLocations.length, 'additional locations on this page');
            locations = locations.concat(additionalLocations);
            nextPageToken = paginatedData.nextPageToken;
          } else {
            const errorText = await paginatedResponse.text();
            console.error('[Local Signals] Failed to fetch paginated locations:', paginatedResponse.status, errorText);
            nextPageToken = null; // Stop pagination on error
          }
        }
        
        console.log('[Local Signals] Total locations after pagination:', locations.length);
      }
      
      // If no locations found, log warning with full response for debugging
      if (locations.length === 0) {
        console.warn('[Local Signals] ⚠️ No locations returned from API. Full response:', JSON.stringify(locationsData, null, 2));
        console.warn('[Local Signals] Response keys:', Object.keys(locationsData));
        console.warn('[Local Signals] This could mean: 1) Account has no locations set up, 2) API permissions issue, 3) Account name format incorrect');
      }
      
      // Fetch detailed information for each location (phone numbers might be in details)
      const locationDetails = [];
      for (const location of locations) {
        try {
          // Get full location details with specific fields (readMask=* is not valid, use specific field names)
          // Request all commonly used fields explicitly, including rating and reviewCount for reviews
          const locationDetailUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${location.name}?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,serviceArea,primaryPhone,primaryCategory,moreHours,rating,reviewCount`;
          console.log('[Local Signals] Fetching location details with reviews:', locationDetailUrl);
          
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
            const errorText = await detailResponse.text();
            // Log error but don't crash - use basic location data instead
            if (detailResponse.status === 400) {
              console.warn(`[Local Signals] Invalid argument (400) for location ${location.name}. Using basic location data. Error: ${errorText.substring(0, 200)}`);
            } else {
              console.warn(`[Local Signals] Failed to get location details (${detailResponse.status}): ${errorText.substring(0, 200)}`);
            }
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
      // IMPORTANT: Always ensure we have locations - if detail fetch failed, use original locations
      if (locationDetails.length > 0) {
        locationsToProcess = locationDetails;
      } else if (locations.length > 0) {
        // If detail fetch failed but we have basic locations, use those
        locationsToProcess = locations;
        console.warn('[Local Signals] Using basic location data (detail fetch failed or returned no data)');
      } else {
        locationsToProcess = [];
      }
      
      // Debug: Log location data to see what we're getting
      if (locationsToProcess.length > 0) {
        console.log('[Local Signals] First location data (full):', JSON.stringify(locationsToProcess[0], null, 2));
      } else {
        console.warn('[Local Signals] ⚠️ No locations to process. Original locations count:', locations.length, 'Detail locations count:', locationDetails.length);
      }
      
      // Extract rating and review count from location details
      // Note: The Business Information API may not include rating/review count in location details
      // We need to check the actual response structure or use a different endpoint
      
      // Try to fetch GBP rating/review count from API (wrapped in try/catch so failures don't crash endpoint)
      try {
        if (locationsToProcess && locationsToProcess.length > 0) {
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
              // Use the Business Profile API v1 endpoint for location details with reviews
              // The rating and reviewCount should be in the location detail, but if not, try fetching full detail
              const locationDetailUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${firstLocation.name}?readMask=name,title,rating,reviewCount`;
              console.log('[Local Signals] Attempting to fetch location detail with reviews:', locationDetailUrl);
              
              const locationDetailResponse = await fetch(locationDetailUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
              });
              
              console.log('[Local Signals] Location detail response status:', locationDetailResponse.status);
              
              if (locationDetailResponse.ok) {
                const locationDetail = await locationDetailResponse.json();
                console.log('[Local Signals] Location detail response:', JSON.stringify(locationDetail, null, 2));
                
                // Extract rating and review count from location detail
                if (locationDetail.rating !== undefined && locationDetail.rating !== null) {
                  gbpRating = parseFloat(locationDetail.rating);
                  console.log('[Local Signals] Extracted rating from location detail:', gbpRating);
                }
                if (locationDetail.reviewCount !== undefined && locationDetail.reviewCount !== null) {
                  gbpReviewCount = parseInt(locationDetail.reviewCount);
                  console.log('[Local Signals] Extracted review count from location detail:', gbpReviewCount);
                }
              } else {
                const errorText = await locationDetailResponse.text();
                console.log('[Local Signals] Location detail response error:', locationDetailResponse.status, errorText);
              }
              
              // Fallback: Try the old Reviews API endpoint (deprecated but might still work)
              if ((gbpRating === null || gbpReviewCount === null) && firstLocation.name) {
                try {
                  const reviewsUrl = `https://mybusiness.googleapis.com/v4/${firstLocation.name}/reviews`;
                  console.log('[Local Signals] Attempting fallback to old Reviews API endpoint:', reviewsUrl);
                
                  const reviewsResponse = await fetch(reviewsUrl, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Content-Type': 'application/json',
                    },
                  });
                
                  console.log('[Local Signals] Reviews API response status:', reviewsResponse.status);
              
              if (reviewsResponse.ok) {
                const reviewsData = await reviewsResponse.json();
                console.log('[Local Signals] Reviews API response:', JSON.stringify(reviewsData, null, 2));
                
                // Extract rating and review count from reviews response
                // The structure might be: { reviews: [...], averageRating: X, totalReviewCount: Y }
                if (reviewsData.averageRating !== undefined) {
                  gbpRating = reviewsData.averageRating;
                  console.log('[Local Signals] Extracted rating from Reviews API:', gbpRating);
                }
                if (reviewsData.totalReviewCount !== undefined) {
                  gbpReviewCount = reviewsData.totalReviewCount;
                  console.log('[Local Signals] Extracted review count from Reviews API:', gbpReviewCount);
                } else if (reviewsData.reviews && Array.isArray(reviewsData.reviews)) {
                  // If we have the reviews array, calculate from it
                  gbpReviewCount = reviewsData.reviews.length;
                  console.log('[Local Signals] Calculated review count from reviews array:', gbpReviewCount);
                  if (reviewsData.reviews.length > 0) {
                    const sumRating = reviewsData.reviews.reduce((sum, review) => sum + (review.starRating || review.rating || 0), 0);
                    gbpRating = sumRating / reviewsData.reviews.length;
                    console.log('[Local Signals] Calculated average rating from reviews array:', gbpRating);
                  }
                } else {
                  console.log('[Local Signals] Reviews API response does not contain rating/review count data');
                }
              } else {
                const errorText = await reviewsResponse.text();
                console.log('[Local Signals] Reviews API response error:', reviewsResponse.status, errorText);
                // Don't assume it's a scope problem - log the actual error for debugging
              }
            } catch (error) {
              console.warn('[Local Signals] Error fetching reviews from Reviews API:', error.message);
                  console.warn('[Local Signals] Error stack:', error.stack);
                }
              }
            } catch (error) {
              console.warn('[Local Signals] Error fetching location detail with reviews:', error.message);
              console.warn('[Local Signals] Error stack:', error.stack);
            }
          }
          
          console.info('[Local Signals] GBP API rating from Google:', {
            rating: gbpRating,
            count: gbpReviewCount,
          });
        } else {
          console.warn('[Local Signals] No GBP locations to process, will rely on fallback if available');
        }
      } catch (err) {
        console.error('[Local Signals] Error while calling GBP API:', err);
        // swallow the error so we can still serve fallback
      }
      
      // Extract service areas and NAP data FIRST (before any file I/O that might fail)
      console.log('[Local Signals] About to extract service areas/NAP. locationsToProcess.length:', locationsToProcess.length);
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
      console.log('[Local Signals] After extraction: serviceAreas.length=', serviceAreas.length, 'napData.length=', napData.length);
    } else {
      const errorText = await locationsResponse.text();
      console.error('[Local Signals] Failed to fetch locations. Status:', locationsResponse.status);
      console.error('[Local Signals] Error response:', errorText);
      
      // Try to parse error for better logging
      let errorData = null;
      try {
        errorData = JSON.parse(errorText);
        console.error('[Local Signals] Parsed error:', JSON.stringify(errorData, null, 2));
      } catch (e) {
        console.error('[Local Signals] Error text (not JSON):', errorText);
      }
      
      // If it's a 403 permission error, return error status so frontend knows to keep cached data
      if (locationsResponse.status === 403) {
        const isScopeError = errorData?.error?.details?.some(d => d.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT');
        if (isScopeError) {
          const fallback = await readGbpFallback();
          return res.status(200).json({
            status: 'error',
            source: 'local-signals',
            params: { property },
            error: {
              code: 'INSUFFICIENT_SCOPES',
              message: 'OAuth token missing required scope. Please regenerate refresh token with business.manage scope.',
              details: errorData
            },
            data: {
              localBusinessSchemaPages: 0,
              napConsistencyScore: null,
              knowledgePanelDetected: false,
              serviceAreas: [],
              locations: [],
              gbpRating: fallback.gbpRating,
              gbpReviewCount: fallback.gbpReviewCount,
              notes: 'API call failed due to insufficient OAuth scopes. Using cached data if available.'
            },
            meta: { generatedAt: new Date().toISOString() }
          });
        }
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
    
    // Fallback to static JSON file if API didn't return rating/review count
    // This runs AFTER locations processing to avoid interfering with it
    if (gbpRating == null || gbpReviewCount == null) {
      const fallback = await readGbpFallback();
      if (fallback.gbpRating != null && fallback.gbpReviewCount != null) {
        gbpRating = fallback.gbpRating;
        gbpReviewCount = fallback.gbpReviewCount;
        console.info('[Local Signals] Using GBP rating from fallback file:', {
          rating: gbpRating,
          count: gbpReviewCount
        });
      }
    }
    
    // Step 4: LocalBusiness schema detection would require website scanning
    // This is a placeholder - would need to scan the website for LocalBusiness schema
    const localBusinessSchemaPages = 0; // TODO: Implement schema scanning
    
    // Final logging before response
    const finalLocations = locationsToProcess.length > 0 ? locationsToProcess : locations;
    console.log('[Local Signals] ===== FINAL SUMMARY =====');
    console.log('[Local Signals] Original locations count:', locations.length);
    console.log('[Local Signals] Processed locations count:', locationsToProcess.length);
    console.log('[Local Signals] Final locations to return:', finalLocations.length);
    console.log('[Local Signals] Service areas count:', serviceAreas.length);
    console.log('[Local Signals] NAP data count:', napData.length);
    console.log('[Local Signals] Knowledge panel detected (based on locations.length > 0):', locations.length > 0);
    if (finalLocations.length > 0) {
      console.log('[Local Signals] First location name:', finalLocations[0].name || finalLocations[0].title || 'unnamed');
    }
    
    // Build response object with error handling to prevent crashes
    try {
      const responseData = {
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
        // Return locations - use processed locations if available, otherwise use original
        locations: finalLocations.map(loc => {
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
        })
      },
      accountName: account?.accountName || account?.name || null,
      accountType: account?.type || null,
      notes: `Fetched ${locations.length} location(s) from Google Business Profile. Service areas: ${serviceAreas.length}.`,
      _debug: {
        originalLocationsCount: locations.length,
        locationsToProcessCount: locationsToProcess.length,
        locationsResponseStatus: locationsResponseStatus,
        hasNextPageToken: !!nextPageToken,
        locationNames: locationsToProcess.map(loc => loc.name || loc.title || 'unnamed')
      }
    };
      
      // Persist latest GBP values to Supabase for refresh accuracy
      updateSupabaseGbp(property, responseData.data.gbpRating, responseData.data.gbpReviewCount);
      
      return res.status(200).json({
        ...responseData,
        meta: { generatedAt: new Date().toISOString() }
      });
    } catch (responseError) {
      // If building response fails, return a minimal response with the locations we have
      console.error('[Local Signals] Error building response object:', responseError);
      console.log('[Local Signals] Returning minimal response with locations:', finalLocations.length);
      return res.status(200).json({
        status: 'ok',
        source: 'local-signals',
        params: { property },
        data: {
          localBusinessSchemaPages: 0,
          napConsistencyScore: napConsistencyScore,
          knowledgePanelDetected: locations.length > 0,
          serviceAreas: serviceAreas,
          locations: finalLocations.map(loc => ({
            name: loc.title || loc.name,
            address: loc.storefrontAddress,
            phone: loc.phoneNumbers?.primaryPhone || loc.primaryPhone || null,
            website: loc.websiteUri
          })),
          gbpRating: gbpRating !== null ? parseFloat(gbpRating) : null,
          gbpReviewCount: gbpReviewCount !== null ? parseInt(gbpReviewCount) : null
        },
        meta: { generatedAt: new Date().toISOString() },
        _warning: 'Response building had errors, returned minimal format'
      });
    }
    
  } catch (error) {
    console.error('[Local Signals] Error in local-signals handler:', error);
    
    // Even on error, try to return fallback GBP data and basic structure
    const fallback = await readGbpFallback();
    let gbpRating = fallback.gbpRating;
    let gbpReviewCount = fallback.gbpReviewCount;
    if (gbpRating != null && gbpReviewCount != null) {
      console.info('[Local Signals] Using GBP rating from fallback file (error recovery):', {
        rating: gbpRating,
        count: gbpReviewCount
      });
    }
    
    // Always return 200 with JSON, even on error (so client doesn't hit "endpoint not available")
    return res.status(200).json({
      status: 'ok',
      source: 'local-signals',
      params: { property: req.query.property || null },
      data: {
        localBusinessSchemaPages: 0,
        napConsistencyScore: null,
        knowledgePanelDetected: false,
        serviceAreas: [],
        locations: [],
        gbpRating: gbpRating !== null ? parseFloat(gbpRating) : null,
        gbpReviewCount: gbpReviewCount !== null ? parseInt(gbpReviewCount) : null,
        notes: `Error occurred: ${error.message || 'Unknown error'}. Using fallback data where available.`
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

