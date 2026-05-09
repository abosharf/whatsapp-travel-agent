const express = require("express");
const path = require("path");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => res.send("✅ Travel Agent is running!"));

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body;

  console.log(`📩 Received from ${from}: ${message}`);
  console.log(`📁 __dirname: ${__dirname}`);
  console.log(`🔑 API Key starts with: ${process.env.ANTHROPIC_API_KEY?.substring(0, 15)}`);

  res.set("Content-Type", "text/xml");

  try {
    const agentPath = path.join(__dirname, "agent");
    console.log(`📁 Loading agent from: ${agentPath}`);
    const agent = require(agentPath);
    console.log(`📁 Agent exports: ${Object.keys(agent).join(", ")}`);
    
    const reply = await agent.handleIncomingMessage(from, message);
    console.log(`✅ Reply: ${reply?.substring(0, 100)}`);
    res.send(`<Response><Message>${reply}</Message></Response>`);
  } catch (err) {
    console.error(`❌ ERROR: ${err.message}`);
    console.error(err.stack);
    res.send(`<Response><Message>Sorry, I encountered an error: ${err.message}</Message></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Running from: ${__dirname}`);
});

