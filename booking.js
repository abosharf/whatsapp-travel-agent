const fetch = require("node-fetch");

async function searchHotels({ destination, checkin, checkout, adults, children_ages }) {
  console.log(`🔍 Searching: ${destination} | ${checkin} → ${checkout} | Adults: ${adults}`);

  try {
    // Use Claude to generate realistic hotel recommendations
    const prompt = `You are a hotel expert. Suggest 4 realistic hotels in ${destination} for a trip from ${checkin} to ${checkout} for ${adults} adults${children_ages && children_ages.length > 0 ? ` and children ages ${children_ages.join(", ")}` : ""}.

Use your knowledge of real hotels in this destination. Prefer 4-5 star family-friendly hotels.

Calculate nights between ${checkin} and ${checkout} and multiply by price_per_night to get total_price.

Respond ONLY with a valid JSON array, no markdown, no extra text:
[
  {
    "name": "Real Hotel Name",
    "stars": 5,
    "rating": 8.9,
    "price_per_night": 600,
    "total_price": 3000,
    "currency": "SAR",
    "area": "Area name in ${destination}",
    "highlights": ["pool", "kids club", "beach"],
    "url": "https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&no_rooms=1"
  }
]`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    console.log(`📦 Search API status: ${response.status}`);

    if (data.error) {
      console.error(`❌ Search API error: ${JSON.stringify(data.error)}`);
      return getBookingLinks(destination, checkin, checkout, adults);
    }

    const textBlocks = (data.content || [])
      .filter(b => b && b.type === "text")
      .map(b => b.text)
      .join("\n");

    console.log(`📦 Raw response preview: ${textBlocks.substring(0, 200)}`);

    // Clean and parse JSON
    const clean = textBlocks.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) {
      console.log("⚠️ No JSON found, using booking links");
      return getBookingLinks(destination, checkin, checkout, adults);
    }

    const hotels = JSON.parse(match[0]);
    
    // Ensure all hotels have proper booking URLs
    return hotels.map(h => ({
      ...h,
      url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(h.name + " " + destination)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&no_rooms=1`
    }));

  } catch (err) {
    console.error(`❌ searchHotels error: ${err.message}`);
    return getBookingLinks(destination, checkin, checkout, adults);
  }
}

// Fallback: direct Booking.com search links
function getBookingLinks(destination, checkin, checkout, adults) {
  const baseUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&no_rooms=1`;
  return [
    {
      name: `5-star hotels in ${destination}`,
      stars: 5,
      rating: 9.0,
      price_per_night: 1200,
      total_price: 6000,
      currency: "SAR",
      area: destination,
      highlights: ["luxury", "pool", "spa"],
      url: baseUrl + "&nflt=class%3D5"
    },
    {
      name: `4-star family resorts in ${destination}`,
      stars: 4,
      rating: 8.5,
      price_per_night: 700,
      total_price: 3500,
      currency: "SAR",
      area: destination,
      highlights: ["family friendly", "pool", "kids activities"],
      url: baseUrl + "&nflt=class%3D4%3Bhotelfacility%3D28"
    },
    {
      name: `Top-rated hotels in ${destination}`,
      stars: 4,
      rating: 8.8,
      price_per_night: 900,
      total_price: 4500,
      currency: "SAR",
      area: destination,
      highlights: ["highly rated", "great location"],
      url: baseUrl + "&nflt=review_score%3D80"
    }
  ];
}

function formatHotelsTable(hotels, tripSegment) {
  if (!hotels || hotels.length === 0) {
    return `❌ No hotels found for ${tripSegment}. Please try different dates.`;
  }

  let table = `🏨 *${tripSegment}*\n`;
  table += `${"─".repeat(30)}\n`;

  hotels.forEach((h, i) => {
    const stars = "⭐".repeat(Math.min(h.stars || 0, 5));
    const highlights = (h.highlights || []).slice(0, 3).join(", ");
    table += `\n*${i + 1}. ${h.name}*\n`;
    if (h.area) table += `📍 ${h.area}\n`;
    table += `${stars} | ⭐ ${h.rating}/10\n`;
    table += `💰 ${h.total_price} ${h.currency} total\n`;
    if (highlights) table += `✨ ${highlights}\n`;
    table += `🔗 ${h.url}\n`;
  });

  table += `\n${"─".repeat(30)}\n`;
  table += `Reply with a number to book (e.g. *1*)`;

  return table;
}

module.exports = { searchHotels, formatHotelsTable };
