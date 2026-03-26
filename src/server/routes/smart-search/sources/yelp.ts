import { peel } from '../../../../index.js';

export async function fetchGooglePlacesHours(businessName: string, address: string): Promise<{
  isOpenNow?: boolean;
  hours?: Record<string, string>;
  todayHours?: string;
  rating?: number;
  reviewCount?: number;
  googleMapsUrl?: string;
} | null> {
  const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!GOOGLE_PLACES_KEY) return null;

  try {
    // Step 1: Find Place from Text (legacy API — cheaper, already enabled)
    const searchQuery = `${businessName} ${address}`;
    const findRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(searchQuery)}&inputtype=textquery&fields=name,place_id,opening_hours,rating,user_ratings_total&key=${GOOGLE_PLACES_KEY}`,
      { signal: AbortSignal.timeout(3000) }
    );

    if (!findRes.ok) return null;
    const findData = await findRes.json();
    if (findData.status !== 'OK' || !findData.candidates?.[0]) return null;
    const candidate = findData.candidates[0];
    const placeId = candidate.place_id;
    if (!placeId) return null;

    // Step 2: Place Details for full hours
    const detailRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,opening_hours,rating,user_ratings_total,url&key=${GOOGLE_PLACES_KEY}`,
      { signal: AbortSignal.timeout(3000) }
    );

    if (!detailRes.ok) return null;
    const detailData = await detailRes.json();
    if (detailData.status !== 'OK' || !detailData.result) return null;
    const place = detailData.result;

    // Parse opening hours from weekday_text
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayMap: Record<string, string> = { 'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed', 'Thursday': 'Thu', 'Friday': 'Fri', 'Saturday': 'Sat', 'Sunday': 'Sun' };
    const hours: Record<string, string> = {};

    if (place.opening_hours?.weekday_text) {
      for (const desc of place.opening_hours.weekday_text) {
        // Format: "Monday: 11:30 AM – 10:00 PM" or "Monday: Closed"
        const colonIdx = desc.indexOf(':');
        if (colonIdx > 0) {
          const dayFull = desc.substring(0, colonIdx).trim();
          const timeStr = desc.substring(colonIdx + 1).trim();
          const shortDay = dayMap[dayFull];
          if (shortDay) {
            hours[shortDay] = timeStr;
          }
        }
      }
    }

    const isOpenNow = place.opening_hours?.open_now;
    const today = shortDays[new Date().getDay()];
    const todayHours = hours[today] || undefined;

    return {
      isOpenNow: isOpenNow ?? undefined,
      hours: Object.keys(hours).length > 0 ? hours : undefined,
      todayHours,
      rating: place.rating,
      reviewCount: place.user_ratings_total,
      googleMapsUrl: place.url,
    };
  } catch {
    return null; // Graceful degradation — Google Places failure is non-fatal
  }
}

export async function fetchYelpResults(keyword: string, location: string) {
  const YELP_API_KEY = process.env.YELP_API_KEY;
  if (!YELP_API_KEY) {
    // Fallback to peel if no API key
    const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;
    const result = await peel(url, { timeout: 8000 });
    return {
      source: 'yelp' as const,
      url,
      businesses: (result.domainData?.structured?.businesses || []) as any[],
      content: result.content,
      domainData: result.domainData,
    };
  }

  const params = new URLSearchParams({
    term: keyword || 'restaurants',
    location: location,
    sort_by: 'rating',
    limit: '20',
  });

  const res = await fetch(`https://api.yelp.com/v3/businesses/search?${params}`, {
    headers: { 'Authorization': `Bearer ${YELP_API_KEY}` },
  });

  if (!res.ok) throw new Error(`Yelp API ${res.status}`);
  const data = await res.json();
  const businesses = (data.businesses || []).map((b: any) => {
    // Parse business hours
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours: Record<string, string> = {};
    const businessHours = b.business_hours?.[0]?.open || [];
    for (const slot of businessHours) {
      const day = dayNames[slot.day] || '';
      const start = `${slot.start.slice(0, 2)}:${slot.start.slice(2)}`;
      const end = `${slot.end.slice(0, 2)}:${slot.end.slice(2)}`;
      if (hours[day]) {
        hours[day] += `, ${start}-${end}`;  // Multiple time slots (lunch + dinner)
      } else {
        hours[day] = `${start}-${end}`;
      }
    }

    // Check if open right now
    const now = new Date();
    const currentDay = dayNames[now.getDay() === 0 ? 6 : now.getDay() - 1]; // JS: 0=Sun, Yelp: 0=Mon
    const currentTime = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    let isOpenNow = false;
    for (const slot of businessHours) {
      if (dayNames[slot.day] === currentDay) {
        if (currentTime >= slot.start && currentTime <= slot.end) {
          isOpenNow = true;
          break;
        }
      }
    }

    return {
      name: b.name,
      rating: b.rating,
      reviewCount: b.review_count,
      address: b.location ? [b.location.address1, b.location.city, b.location.state].filter(Boolean).join(', ') : '',
      price: b.price || '',
      categories: (b.categories || []).map((c: any) => c.title).join(', '),
      url: b.url || '',
      phone: b.display_phone || '',
      image_url: b.image_url || '',
      distance: b.distance,
      // NEW FIELDS:
      hours,
      isOpenNow,
      isClosed: b.is_closed === true,  // permanently closed
      transactions: b.transactions || [],  // ['delivery', 'pickup']
      todayHours: hours[currentDay] || 'Closed today',
      googleMapsUrl: undefined as string | undefined,
      googleRating: undefined as number | undefined,
      googleReviewCount: undefined as number | undefined,
    };
  });

  // Verify hours for top 3 results via Google Places (if API key available)
  if (process.env.GOOGLE_PLACES_API_KEY) {
    const top3 = businesses.slice(0, 3);
    const googleResults = await Promise.allSettled(
      top3.map((b: any) => fetchGooglePlacesHours(b.name, b.address))
    );

    for (let i = 0; i < top3.length; i++) {
      const gResult = googleResults[i];
      if (gResult.status === 'fulfilled' && gResult.value) {
        const g = gResult.value;
        // Google is more reliable for hours — prefer Google's data
        if (g.isOpenNow !== undefined) businesses[i].isOpenNow = g.isOpenNow;
        if (g.todayHours) businesses[i].todayHours = g.todayHours;
        if (g.hours && Object.keys(g.hours).length > 0) businesses[i].hours = g.hours;
        if (g.googleMapsUrl) businesses[i].googleMapsUrl = g.googleMapsUrl;
        // Add Google rating as secondary reference
        if (g.rating) businesses[i].googleRating = g.rating;
        if (g.reviewCount) businesses[i].googleReviewCount = g.reviewCount;
      }
    }
  }

  const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;
  return {
    source: 'yelp' as const,
    url,
    businesses,
    content: '',
    domainData: { structured: { businesses } },
  };
}
