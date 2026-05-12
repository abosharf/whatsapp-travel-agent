const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const { searchHotels, formatHotelsTable } = require("./booking");

// ─── Session Storage (file-based so it survives restarts) ───────────────────
const SESSION_FILE = path.join("/tmp", "sessions.json");

function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    }
  } catch (e) {}
  return {};
}

function saveSessions(sessions) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions), "utf-8");
  } catch (e) {
    console.error("❌ Could not save sessions:", e.message);
  }
}

function getSession(userId) {
  const sessions = loadSessions();
  if (!sessions[userId]) {
    sessions[userId] = {
      userId,
      history: [],
      lastHotels: {},
      selectedHotels: [],
      pendingSegments: [],
      step: "idle",
      searchParams: {},
    };
    saveSessions(sessions);
  }
  return sessions[userId];
}

function updateSession(userId, updates) {
  const sessions = loadSessions();
  sessions[userId] = { ...getSession(userId), ...updates };
  saveSessions(sessions);
}

function addMessage(userId, role, content) {
  const sessions = loadSessions();
  const session = sessions[userId] || getSession(userId);
  session.history = session.history || [];
  session.history.push({ role, content });
  if (session.history.length > 20) session.history = session.history.slice(-20);
  sessions[userId] = session;
  saveSessions(sessions);
}

// ─── Owner Preferences ───────────────────────────────────────────────────────
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

// ─── Claude API Call ──────────────────────────────────────────────────────────
async function callClaude(messages) {
  console.log(`🤖 Calling Claude with ${messages.length} messages`);

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
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.find(b => b.type === "text")?.text || "";
  console.log(`🤖 Reply: ${text.substring(0, 150)}`);
  return text;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
async function handleIncomingMessage(userId, message) {
  console.log(`👤 From ${userId}: ${message}`);
  const session = getSession(userId);

  console.log(`📊 Session step: ${session.step} | Pending segments: ${session.pendingSegments?.length || 0}`);

  // ── Handle hotel number selection ──
  if (session.step === "selecting") {
    const trimmed = message.trim();
    const choice = parseInt(trimmed) - 1;
    const pendingSegments = session.pendingSegments || [];

    if (pendingSegments.length > 0 && !isNaN(choice) && choice >= 0) {
      const currentSegment = pendingSegments[0];
      const hotels = (session.lastHotels || {})[currentSegment.label] || [];

      console.log(`🔢 User chose ${choice + 1} from ${hotels.length} hotels in ${currentSegment.label}`);

      if (hotels[choice]) {
        const selected = hotels[choice];
        const updatedSelected = [...(session.selectedHotels || []), { ...selected, segment: currentSegment.label }];
        const remaining = pendingSegments.slice(1);

        updateSession(userId, {
          pendingSegments: remaining,
          selectedHotels: updatedSelected,
        });

        if (remaining.length > 0) {
          console.log(`➡️ Moving to next segment: ${remaining[0].label}`);
          return await searchNextSegment(userId, remaining[0]);
        } else {
          updateSession(userId, { step: "idle" });
          return buildBookingSummary(updatedSelected);
        }
      } else {
        return `❌ الرجاء اختيار رقم بين 1 و ${hotels.length}`;
      }
    }
  }

  // ── Regular conversation ──
  addMessage(userId, "user", message);
  const reply = await callClaude(getSession(userId).history);
  addMessage(userId, "assistant", reply);

  if (reply.includes("SEARCH_HOTELS:")) {
    return await handleHotelSearch(userId, reply);
  }

  return reply;
}

// ─── Hotel Search ─────────────────────────────────────────────────────────────
async function handleHotelSearch(userId, claudeReply) {
  try {
    const match = claudeReply.match(/SEARCH_HOTELS:\s*(\{[\s\S]*?\})\s*(?:\n|$)/m);
    if (!match) {
      console.error("❌ Could not parse SEARCH_HOTELS");
      return claudeReply.replace(/SEARCH_HOTELS:.*/m, "").trim();
    }

    const { segments } = JSON.parse(match[1]);
    console.log(`🔍 Searching ${segments.length} segments`);

    updateSession(userId, {
      pendingSegments: segments,
      lastHotels: {},
      selectedHotels: [],
      step: "selecting",
    });

    return await searchNextSegment(userId, segments[0]);
  } catch (err) {
    console.error("❌ handleHotelSearch error:", err.message);
    return "عذراً، حدث خطأ. الرجاء المحاولة مرة أخرى.";
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

  // Save hotels to session
  const updatedHotels = { ...(session.lastHotels || {}), [segment.label]: hotels };
  updateSession(userId, { lastHotels: updatedHotels });

  console.log(`✅ Saved ${hotels.length} hotels for "${segment.label}"`);
  return formatHotelsTable(hotels, segment.label);
}

// ─── Booking Summary ──────────────────────────────────────────────────────────
function buildBookingSummary(selectedHotels) {
  let msg = `✅ *ملخص رحلتك*\n──────────────────────\n\n`;

  selectedHotels.forEach((h, i) => {
    const searchName = encodeURIComponent((h.name || "") + " " + (h.area || h.segment || ""));
    const url = `https://www.booking.com/search.html?ss=${searchName}`;
    msg += `*${i + 1}. ${h.name}*\n`;
    msg += `💰 ${h.total_price} ${h.currency || "SAR"}\n`;
    msg += `🔗 ${url}\n\n`;
  });

  const total = selectedHotels.reduce((s, h) => s + (h.total_price || 0), 0);
  const currency = selectedHotels[0]?.currency || "SAR";
  msg += `──────────────────────\n`;
  msg += `💳 *الإجمالي: ${total} ${currency}*`;

  return msg;
}

module.exports = { handleIncomingMessage };
