const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const mailchimp = require('@mailchimp/mailchimp_marketing');

const app = express();
app.use(express.json());
app.use(cors());

const XAI_API_KEY = process.env.XAI_API_KEY;

// Mailchimp setup
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX // e.g., 'us1'
});

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

  // Add to Mailchimp
  try {
    const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
    const response = await mailchimp.lists.addListMember(audienceId, {
      email_address: email,
      status: 'subscribed',
      merge_fields: {
        FNAME: name,
        WEBSITE: url
      },
      tags: ['RankScore Lite Leads']
    });
    console.log('Lead added to Mailchimp:', response.email_address);
  } catch (err) {
    console.error('Error adding to Mailchimp:', err.response ? err.response.text : err);
  }

  // Generate SEO tips
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
   try {
     const prompt = `Analyze ${url} for quick Answer Engine Optimization wins. Provide 3 simple improvements (e.g., meta tags, load speed) in a concise bulleted list.`;
     const result = await callGrok(prompt);
