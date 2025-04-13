const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const XAI_API_KEY = process.env.XAI_API_KEY;

// Health check endpoint for Railway
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

async function callGrok(prompt) {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
    }),
  });
  const data = await response.json();
  return data.choices[0].message.content;
}

app.post('/api/lite', async (req, res) => {
  const { name, email, url } = req.body;
  if (!email || !url) {
    return res.status(400).json({ error: 'Missing email or URL' });
  }
  try {
    const prompt = `Analyze ${url} for quick Answer Engine Optimization wins. Provide 3 simple improvements (e.g., meta tags, load speed) in a concise bulleted list.`;
    const result = await callGrok(prompt);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
