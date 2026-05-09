const fetch = require("node-fetch");

async function searchHotels({ destination, checkin, checkout, adults, children_ages }) {
  console.log(`🔍 Searching: ${destination} | ${checkin} → ${checkout} | Adults: ${adults}`);

  try {
    const prompt = `You are a hotel expert. Suggest 3 real hotels in ${destination} from ${checkin} to ${checkout} for ${adults} adults${children_ages && children_ages.length > 0 ? ` and children ages ${children_ages.join(", ")}` : ""}.

Prefer 4-5 star family-friendly hotels. Calculate total_price as nights × price_per_night.

Respond ONLY with a JSON array, no markdown:
[{"name":"Hotel Name","stars":5,"rating":9.0,"price_per_night":600,"total_price":3000,"currency":"SAR","area":"Area"}]`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return getBookingLinks(destination, checkin, checkout, adults);

    const text = (data.content || []).filter(b => b?.type === "text").map(b => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return getBookingLinks(destination, checkin, checkout, adults);

    const hotels = JSON.parse(match[0]);
    console.log(`✅ Found ${hotels.length} hotels`);
    return hotels;

  } catch (err) {
    console.error(`❌ searchHotels error: ${err.message}`);
    return getBookingLinks(destination, checkin, checkout, adults);
  }
}

function getBookingLinks(destination, checkin, checkout, adults) {
  const base = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(destination)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}`;
  return [
    { name: `5-star in ${destination}`, stars: 5, rating: 9.0, price_per_night: 1200, total_price: 6000, currency: "SAR", area: destination, bookingUrl: base + "&nflt=class%3D5" },
    { name: `4-star family in ${destination}`, stars: 4, rating: 8.5, price_per_night: 700, total_price: 3500, currency: "SAR", area: destination, bookingUrl: base + "&nflt=class%3D4" },
    { name: `Top-rated in ${destination}`, stars: 4, rating: 8.8, price_per_night: 900, total_price: 4500, currency: "SAR", area: destination, bookingUrl: base + "&nflt=review_score%3D80" }
  ];
}

function formatHotelsTable(hotels, tripSegment) {
  if (!hotels || hotels.length === 0) {
    return `❌ No hotels found. Please try again.`;
  }

  // Store hotels with index for booking URL generation
  let table = `🏨 *${tripSegment}*\n`;
  table += `──────────────────────\n`;

  hotels.slice(0, 3).forEach((h, i) => {
    const stars = "⭐".repeat(Math.min(h.stars || 0, 5));
    table += `\n*${i + 1}. ${h.name}*\n`;
    table += `${stars} ${h.rating}/10\n`;
    table += `💰 ${h.total_price} ${h.currency}\n`;
    if (h.area) table += `📍 ${h.area}\n`;
  });

  table += `\n──────────────────────\n`;
  table += `Reply *1*, *2*, or *3* to select`;

  return table;
}

module.exports = { searchHotels, formatHotelsTable };
