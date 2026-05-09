const express = require("express");
const { handleIncomingMessage } = require("./agent");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => res.send("✅ Travel Agent is running!"));

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body;

  console.log(`📩 Message from ${from}: ${message}`);

  try {
    const reply = await handleIncomingMessage(from, message);
    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>${reply}</Message></Response>`);
  } catch (err) {
    console.error("Error:", err);
    res.set("Content-Type", "text/xml");
    res.send(`<Response><Message>Sorry, something went wrong. Please try again.</Message></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
