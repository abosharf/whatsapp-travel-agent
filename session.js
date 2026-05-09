const sessions = {};

function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = {
      userId,
      history: [],
      currentSearch: null,
      lastHotels: {},
      selectedHotels: [],
      pendingSegments: [],
      step: "idle",
      searchParams: {},
      createdAt: new Date(),
    };
  }
  return sessions[userId];
}

function updateSession(userId, updates) {
  sessions[userId] = { ...getSession(userId), ...updates };
}

function addMessage(userId, role, content) {
  const session = getSession(userId);
  session.history.push({ role, content });
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }
}

function clearSession(userId) {
  delete sessions[userId];
}

module.exports = { getSession, updateSession, addMessage, clearSession };
