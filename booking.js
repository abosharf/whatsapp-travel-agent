const fetch = require("node-fetch");

const BOOKING_MCP_URL = "https://demandapi-mcp.booking.com/v1/mcp/8132308";

async function searchHotels({ destination, checkin, checkout, adults, children_ages }) {
  console.log(`🔍 Searching: ${destination} | ${checkin} → ${checkout} | Adults: ${adults}`);

  try {
    const prompt = `Search for the top 5 hotels in ${destination} from ${checkin} to ${checkout} for ${adults} adults${children_ages && children_ages.length > 0 ? ` and ${children_ages.length} children ages ${children_ages.join(", ")}` : ""}.

Respond ONLY with a valid JSON array. No text before or after. No markdown. Just the JSON array:
[
  {
    "name": "Hotel Name",
    "stars": 5,
    "rating": 8.9,
    "price_per_night": 500,
    "total_price": 2500,
    "currency": "SAR",
    "highlights": ["pool", "beach", "kids club"],
    "url": "https://www.booking.com/hotel/..."
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
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        mcp_servers: [{ type: "url", url: BOOKING_MCP_URL, name: "booking" }],
      }),
    });

    const data = await response.json();
    console.log(`📦 Booking API status: ${response.status}`);

    if (data.error) {
      console.error(`❌ Booking API error: ${JSON.stringify(data.error)}`);
      return getFallbackHotels(destination, checkin, checkout);
    }

    // Extract all text blocks
    const textBlocks = (data.content || [])
      .filter(b => b && b.type === "text")
      .map(b => b.text)
      .join("\n");

    console.log(`📦 Raw response: ${textBlocks.substring(0, 300)}`);

    // Find JSON array in response
    const match = textBlocks.match(/\[[\s\S]*?\]/);
    if (!match) {
      console.log("⚠️ No JSON array found in response, using fallback");
      return getFallbackHotels(destination, checkin, checkout);
    }

    const hotels = JSON.parse(match[0]);
    console.log(`✅ Found ${hotels.length} hotels`);
    return hotels;

  } catch (err) {
    console.error(`❌ searchHotels error: ${err.message}`);
    return getFallbackHotels(destination, checkin, checkout);
  }
}

// Fallback hotels when search fails
function getFallbackHotels(destination, checkin, checkout) {
  console.log(`⚠️ Using fallback hotels for ${destination}`);
  return [
    {
      name: `Search results for ${destination}`,
      stars: 5,
      rating: 9.0,
      price_per_night: 800,
      total_price: 4000,
      currency: "SAR",
      highlights: ["pool", "beach", "family friendly"],
      url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}&checkin=${checkin}&checkout=${checkout}`
    },
    {
      name: `View all hotels in ${destination}`,
      stars: 4,
      rating: 8.5,
      price_per_night: 500,
      total_price: 2500,
      currency: "SAR",
      highlights: ["great location", "good value"],
      url: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}&checkin=${checkin}&checkout=${checkout}&nflt=class%3D4`
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
    table += `${stars} | ⭐ ${h.rating}/10\n`;
    table += `💰 ${h.total_price} ${h.currency} total\n`;
    if (highlights) table += `✨ ${highlights}\n`;
  });

  table += `\n${"─".repeat(30)}\n`;
  table += `Reply with a number to select (e.g. *1*)`;

  return table;
}

module.exports = { searchHotels, formatHotelsTable };
