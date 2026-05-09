const fetch = require("node-fetch");
const { getSession, updateSession, addMessage } = require("./session");
const { searchHotels, formatHotelsTable } = require("./booking");

// ============================================================
// ✏️  EDIT THIS SECTION TO TRAIN YOUR AGENT'S PREFERENCES
// ============================================================
const OWNER_PREFERENCES = `
## Hotel Preferences

### General Rules
- Always prefer 4-star and 5-star hotels
- Avoid hostels, motels, and budget guesthouses
- Family rooms or suites preferred for families with children
- Pool is a must-have for beach destinations
- Kids club or children activities preferred for family trips
- Beachfront or sea view preferred when available
- Never recommend hotels below 7.5 rating

### By Destination
**Bali:**
- Always include one hotel in Ubud (nature/culture)
- One hotel near the beach (Seminyak, Jimbaran, or Nusa Dua)
- One hotel can be central (Kuta or Legian area)

**Phuket:**
- Kata Beach or Karon Beach for families (calm water)
- Avoid Patong Beach for families (too noisy)
- Prefer resorts with water slides or kids activities

**Dubai:**
- JBR, Palm Jumeirah, or Downtown area preferred
- All-inclusive or half-board preferred

**Maldives:**
- Water villas preferred
- All-inclusive mandatory
- Minimum 4.5 star rating

### Budget Guidelines
- Budget: under SAR 800/night
- Mid-range: SAR 800-2000/night
- Luxury: SAR 2000+/night
- If customer doesn't mention budget, assume mid-range

### Multi-Hotel Trips
- Mix areas so customer experiences different parts of destination
- Start with most central, end with most relaxing
- Each segment minimum 3 nights
`;
// ============================================================

const SYSTEM_PROMPT = `You are a professional travel booking assistant on WhatsApp.

## Your Owner's Hotel Preferences:
${OWNER_PREFERENCES}

## Instructions:
1. Understand trip requests (destination, dates, nights, number of hotels, guests)
2. Apply the owner's preferences when selecting hotels
3. Handle multi-hotel trips (e.g. 15 nights = 3 hotels x 5 nights each)
4. When you have enough info to search, respond with ONLY this format:
   SEARCH_HOTELS: {"segments":[{"destination":"Ubud, Bali","checkin":"2026-08-01","checkout":"2026-08-06","label":"Hotel 1 - Ubud"}]}
5. If info is missing, ask for it (dates, number of guests, children ages)
6. Respond in the same language the customer uses (Arabic or English)
7. Be friendly, concise, and professional

Today's date: ${new Date().toISOString().split("T")[0]}
`;

async function callClaude(messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  const data = await response.json();
  return data.content?.find((b) => b.type === "text")?.text || "";
}

async function handleIncomingMessage(userId, message) {
  const session = getSession(userId);
  addMessage(userId, "user", message);

  // Handle hotel selection
  if (session.step === "selecting" && session.pendingSegments?.length > 0) {
    const choice = parseInt(message.trim()) - 1;
    const currentSegment = session.pendingSegments[0];
    const hotels = session.lastHotels[currentSegment.label] || [];

    if (!isNaN(choice) && hotels[choice]) {
      const selected = hotels[choice];
      const updatedSelected = [...(session.selectedHotels || []), { ...selected, segment: currentSegment.label }];
      const remaining = session.pendingSegments.slice(1);
      updateSession(userId, { pendingSegments: remaining, selectedHotels: updatedSelected });

      if (remaining.length > 0) {
        return await searchNextSegment(userId, remaining[0]);
      } else {
        updateSession(userId, { step: "idle" });
        return buildBookingSummary(updatedSelected);
      }
    } else {
      return `❌ Please reply with a number between 1 and ${hotels.length}`;
    }
  }

  // Regular AI conversation
  const reply = await callClaude(session.history);
  addMessage(userId, "assistant", reply);

  if (reply.includes("SEARCH_HOTELS:")) {
    return await handleHotelSearch(userId, reply);
  }

  return reply;
}

async function handleHotelSearch(userId, claudeReply) {
  try {
    const match = claudeReply.match(/SEARCH_HOTELS:\s*({[\s\S]*})/);
    if (!match) return claudeReply;

    const searchData = JSON.parse(match[1]);
    const segments = searchData.segments;

    updateSession(userId, {
      pendingSegments: segments,
      lastHotels: {},
      selectedHotels: [],
      step: "selecting",
    });

    return await searchNextSegment(userId, segments[0]);
  } catch (err) {
    console.error("Search parse error:", err);
    return "Sorry, I had trouble processing your request. Please try again.";
  }
}

async function searchNextSegment(userId, segment) {
  const session = getSession(userId);

  const hotels = await searchHotels({
    destination: segment.destination,
    checkin: segment.checkin,
    checkout: segment.checkout,
    adults: session.searchParams?.adults || 2,
    children_ages: session.searchParams?.children_ages || [],
  });

  const updatedHotels = { ...session.lastHotels, [segment.label]: hotels };
  updateSession(userId, { lastHotels: updatedHotels });

  return formatHotelsTable(hotels, segment.label);
}

function buildBookingSummary(selectedHotels) {
  let msg = `✅ *Your Trip Summary*\n${"─".repeat(30)}\n\n`;

  selectedHotels.forEach((h, i) => {
    msg += `*${i + 1}. ${h.segment}*\n`;
    msg += `🏨 ${h.name}\n`;
    msg += `💰 ${h.total_price} ${h.currency}\n`;
    msg += `🔗 ${h.url}\n\n`;
  });

  const total = selectedHotels.reduce((sum, h) => sum + (h.total_price || 0), 0);
  const currency = selectedHotels[0]?.currency || "SAR";

  msg += `${"─".repeat(30)}\n`;
  msg += `💳 *Total: ${total} ${currency}*\n\n`;
  msg += `Tap each link above to complete your booking on Booking.com 🎉`;

  return msg;
}

module.exports = { handleIncomingMessage };
