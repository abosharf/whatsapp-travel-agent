const fetch = require("node-fetch");
const { getSession, updateSession, addMessage } = require("./session");
const { searchHotels, formatHotelsTable } = require("./booking");

const OWNER_PREFERENCES = `
## Hotel Preferences
- Always prefer 4-star and 5-star hotels
- Pool is a must-have for beach destinations
- Kids club preferred for family trips
- Never recommend hotels below 7.5 rating
- If no budget mentioned, assume mid-range (SAR 800-2000/night)

### By Destination
**Bali:** One hotel in Ubud, one near beach (Seminyak/Jimbaran/Nusa Dua), one central
**Phuket:** Kata or Karon Beach for families, avoid Patong
**Dubai:** JBR, Palm Jumeirah, or Downtown preferred
**Maldives:** Water villas, all-inclusive mandatory

### Multi-Hotel Trips
- Mix areas so customer experiences different parts
- Start central, end relaxing
- Each segment minimum 3 nights
`;

const SYSTEM_PROMPT = `You are a professional travel booking assistant on WhatsApp.

## Your Owner's Hotel Preferences:
${OWNER_PREFERENCES}

## Instructions:
1. Understand trip requests (destination, dates, nights, number of hotels, guests)
2. Apply the owner's preferences when selecting hotels
3. Handle multi-hotel trips (e.g. 15 nights = 3 hotels x 5 nights each)
4. When you have enough info to search, respond with ONLY this exact format on its own line:
   SEARCH_HOTELS: {"segments":[{"destination":"Ubud, Bali","checkin":"2026-08-01","checkout":"2026-08-06","label":"Hotel 1 - Ubud"}]}
5. If info is missing (dates, guests, children ages), ask ONE question at a time
6. Respond in the same language the customer uses (Arabic or English)
7. Be friendly, concise, professional

Today's date: ${new Date().toISOString().split("T")[0]}

IMPORTANT: When you have enough info, ALWAYS output the SEARCH_HOTELS line to trigger the search.
`;

async function callClaude(messages) {
  console.log(`🤖 Calling Claude API with ${messages.length} messages`);
  
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  const data = await response.json();
  console.log(`🤖 Claude response status: ${response.status}`);
  
  if (data.error) {
    console.error(`❌ Claude API error: ${JSON.stringify(data.error)}`);
    throw new Error(`Claude API error: ${data.error.message}`);
  }

  const text = data.content?.find((b) => b.type === "text")?.text || "";
  console.log(`🤖 Claude reply: ${text.substring(0, 200)}`);
  return text;
}

async function handleIncomingMessage(userId, message) {
  console.log(`👤 Handling message from ${userId}: ${message}`);
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
    const match = claudeReply.match(/SEARCH_HOTELS:\s*({[\s\S]*?})\s*$/m);
    if (!match) {
      console.error("❌ Could not parse SEARCH_HOTELS from:", claudeReply);
      return claudeReply.replace(/SEARCH_HOTELS:.*$/m, "").trim() || "Let me search for hotels for you...";
    }

    const searchData = JSON.parse(match[1]);
    const segments = searchData.segments;
    console.log(`🔍 Searching ${segments.length} hotel segments`);

    updateSession(userId, {
      pendingSegments: segments,
      lastHotels: {},
      selectedHotels: [],
      step: "selecting",
    });

    return await searchNextSegment(userId, segments[0]);
  } catch (err) {
    console.error("❌ Search parse error:", err);
    return "Sorry, I had trouble processing your request. Please try again.";
  }
}

async function searchNextSegment(userId, segment) {
  const session = getSession(userId);
  console.log(`🔍 Searching hotels in ${segment.destination}`);

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
