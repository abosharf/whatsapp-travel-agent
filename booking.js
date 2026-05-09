const fetch = require("node-fetch");

const BOOKING_MCP_URL = process.env.BOOKING_MCP_URL || "https://demandapi-mcp.booking.com/v1/mcp/8132308";

async function searchHotels({ destination, checkin, checkout, adults, children_ages }) {
  const prompt = `Search for hotels with these details:
- Destination: ${destination}
- Check-in: ${checkin}
- Check-out: ${checkout}
- Adults: ${adults}
- Children ages: ${(children_ages || []).join(", ") || "none"}

Return the top 5 available hotels. 
Respond ONLY with a valid JSON array, no extra text, no markdown:
[{"name":"...","stars":5,"rating":8.9,"price_per_night":500,"total_price":2500,"currency":"SAR","highlights":["pool","beach"],"url":"https://booking.com/..."}]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
      mcp_servers: [{ type: "url", url: BOOKING_MCP_URL, name: "booking" }],
    }),
  });

  const data = await response.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

function formatHotelsTable(hotels, tripSegment) {
  if (!hotels || hotels.length === 0) {
    return "❌ No hotels found for this search. Try different dates or destination.";
  }

  let table = `🏨 *${tripSegment}*\n`;
  table += `${"─".repeat(30)}\n`;

  hotels.forEach((h, i) => {
    const stars = "⭐".repeat(Math.min(h.stars || 0, 5));
    const highlights = (h.highlights || []).slice(0, 3).join(", ");
    table += `\n*${i + 1}. ${h.name}*\n`;
    table += `${stars} | Rating: ${h.rating}/10\n`;
    table += `💰 ${h.total_price} ${h.currency} total\n`;
    if (highlights) table += `✨ ${highlights}\n`;
  });

  table += `\n${"─".repeat(30)}\n`;
  table += `Reply with a number to select (e.g. *1*)`;

  return table;
}

module.exports = { searchHotels, formatHotelsTable };
