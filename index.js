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
 @@ -35,6 +42,26 @@ app.post('/api/lite', async (req, res) => {
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
     // Note: We don't return here, so the SEO tips generation continues even if Mailchimp fails
   }
 
   // Generate SEO tips
   try {
     const prompt = `Analyze ${url} for quick Answer Engine Optimization wins. Provide 3 simple improvements (e.g., meta tags, load speed) in a concise bulleted list.`;
     const result = await callGrok(prompt);
