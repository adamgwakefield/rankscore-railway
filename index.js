const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pdfkit = require('pdfkit');
const fs = require('fs');
const cheerio = require('cheerio');
const validator = require('validator');
const mailchimp = require('@mailchimp/mailchimp_marketing');

const app = express();
app.use(express.json());
app.use(cors());

const XAI_API_KEY = process.env.XAI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const MONGO_URI = process.env.MONGO_URI;

// Mailchimp setup
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX // e.g., 'us1'
});

// Connect to MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// User Schema
const userSchema = new mongoose.Schema({
  email: String,
  stripeCustomerId: String,
  scanCount: { type: Number, default: 0 },
  scanLimit: { type: Number, default: 5 },
  scans: [{ url: String, report: String, date: Date }],
});
const User = mongoose.model('User', userSchema);

// Middleware to verify JWT
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Health check endpoint for Railway
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// Existing /api/lite endpoint
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

// AEO Analysis Functions (Translated from Python)
function validateUrl(url) {
  return validator.isURL(url);
}

async function analyzeMetadata(url) {
  try {
    const response = await fetch(url, { timeout: 10000 });
    const html = await response.text();
    const $ = cheerio.load(html);
    const title = $('title').text() || 'Missing';
    const description = $('meta[name="description"]').attr('content') || 'Missing';
    const recommendation = description === 'Missing' ? 'Consider adding a meta description to improve visibility and SEO.' : 'Meta description is present.';
    return { title, description, recommendation };
  } catch (e) {
    return { title: 'Error', description: `Error fetching metadata: ${e.message}`, recommendation: 'N/A' };
  }
}

function analyzeHeaders(html) {
  const $ = cheerio.load(html);
  const h1Tags = $('h1');
  const h2Tags = $('h2');
  return { h1_present: h1Tags.length > 0, h2_present: h2Tags.length > 0, h1_count: h1Tags.length, h2_count: h2Tags.length };
}

function analyzeStructuredData(html) {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');
  return scripts.length > 0;
}

function analyzeFAQ(html) {
  const $ = cheerio.load(html);
  const faqSchema = $('script[type="application/ld+json"]').filter((i, el) => $(el).html().includes('FAQPage'));
  return faqSchema.length > 0;
}

function analyzeMobileFriendly(html) {
  const $ = cheerio.load(html);
  const viewportMeta = $('meta[name="viewport"]');
  return viewportMeta.length > 0;
}

function analyzeAccessibility(html) {
  const $ = cheerio.load(html);
  const images = $('img');
  const imagesWithAlt = images.filter((i, el) => $(el).attr('alt'));
  return images.length === imagesWithAlt.length;
}

async function analyzePageSpeed(url) {
  try {
    const metrics = {
      total_time: 0, time_to_first_byte: 0, resource_count: 0,
      total_size: 0, resource_types: {}, performance_score: 0
    };
    const startTime = Date.now();
    const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
    metrics.time_to_first_byte = Date.now() - startTime;

    const htmlResponse = await fetch(url, { timeout: 10000 });
    const html = await htmlResponse.text();
    const $ = cheerio.load(html);
    const resources = [
      ...$('script[src]').map((i, el) => [$(el).attr('src'), 'script']).get(),
      ...$('link[rel="stylesheet"]').map((i, el) => [$(el).attr('href'), 'css']).get(),
      ...$('img[src]').map((i, el) => [$(el).attr('src'), 'image']).get()
    ];
    metrics.resource_count = resources.length;
    metrics.total_size = resources.length * 10000; // Placeholder
    resources.forEach(([resourceUrl, type]) => {
      metrics.resource_types[type] = (metrics.resource_types[type] || 0) + 1;
    });

    metrics.total_time = Date.now() - startTime;
    let score = 100;
    if (metrics.time_to_first_byte > 200) score -= 20;
    if (metrics.total_time > 3000) score -= 20;
    if (metrics.resource_count > 50) score -= 20;
    if (metrics.total_size > 5000000) score -= 20;
    metrics.performance_score = Math.max(0, score);

    return metrics;
  } catch (e) {
    return { error: e.message, total_time: 0, time_to_first_byte: 0, resource_count: 0, total_size: 0, resource_types: {}, performance_score: 0 };
  }
}

function calculateRankscore(metadata, headers, structuredData, faqPresent, mobileFriendly, accessibility, speedMetrics) {
  const structuredDataScore = structuredData ? 25 : 0;
  const faqScore = faqPresent ? 20 : 0;
  const headerScore = headers.h1_present ? 15 : 0;
  const titleScore = metadata.title !== 'Missing' ? 10 : 0;
  const speedScore = speedMetrics.performance_score >= 80 ? 10 : 0;
  const descriptionScore = metadata.description !== 'Missing' ? 8 : 0;
  const mobileScore = mobileFriendly ? 7 : 0;
  const accessibilityScore = accessibility ? 5 : 0;

  const totalScore = structuredDataScore + faqScore + headerScore + titleScore + speedScore + descriptionScore + mobileScore + accessibilityScore;

  return {
    total_score: totalScore,
    subscores: {
      content_structure: structuredDataScore + faqScore + headerScore,
      technical: speedScore + mobileScore,
      metadata: titleScore + descriptionScore,
      accessibility: accessibilityScore
    },
    component_scores: {
      structured_data: structuredDataScore, faq: faqScore, headers: headerScore, title: titleScore,
      speed: speedScore, description: descriptionScore, mobile: mobileScore, accessibility: accessibilityScore
    }
  };
}

function prioritizeQuickWins(metadata, headers, structuredData, faqPresent, mobileFriendly, accessibility, speedMetrics) {
  const issues = [];
  if (metadata.title === 'Missing') issues.push({ type: 'title', priority: 1, effort: 'Low', fix: 'Add a descriptive title tag', example: 'Best Italian Recipes | Easy Guide' });
  if (metadata.description === 'Missing') issues.push({ type: 'description', priority: 2, effort: 'Low', fix: 'Add a meta description', example: 'Discover easy Italian recipes...' });
  if (!headers.h1_present) issues.push({ type: 'h1', priority: 1, effort: 'Low', fix: 'Add an H1 header', example: 'Welcome to Italian Recipes' });
  if (!structuredData) issues.push({ type: 'structured_data', priority: 3, effort: 'Medium', fix: 'Implement structured data', example: 'Add Recipe schema markup...' });
  if (!faqPresent) issues.push({ type: 'faq', priority: 3, effort: 'Medium', fix: 'Add FAQ schema markup', example: 'Include FAQs with schema...' });
  if (!mobileFriendly) issues.push({ type: 'mobile', priority: 2, effort: 'Medium', fix: 'Implement responsive design', example: '<meta name="viewport" content="width=device-width">' });
  if (!accessibility) issues.push({ type: 'accessibility', priority: 2, effort: 'Low', fix: 'Add image alt text', example: '<img src="pasta.jpg" alt="Fresh pasta">' });
  if (speedMetrics.time_to_first_byte > 200) issues.push({ type: 'speed', priority: 1, effort: 'Medium', fix: 'Improve server response', example: 'Optimize server config...' });
  if (speedMetrics.total_size > 5000000) issues.push({ type: 'speed', priority: 2, effort: 'Medium', fix: 'Reduce page size', example: 'Compress images...' });
  if (speedMetrics.resource_count > 50) issues.push({ type: 'speed', priority: 2, effort: 'Medium', fix: 'Reduce requests', example: 'Combine CSS files...' });
  return issues.sort((a, b) => a.priority - b.priority || (a.effort === 'Low' ? -1 : 1));
}

async function generateReport(url) {
  const response = await fetch(url, { timeout: 10000 });
  const html = await response.text();
  const metadata = await analyzeMetadata(url);
  const headers = analyzeHeaders(html);
  const structuredData = analyzeStructuredData(html);
  const faqPresent = analyzeFAQ(html);
  const mobileFriendly = analyzeMobileFriendly(html);
  const accessibility = analyzeAccessibility(html);
  const speedMetrics = await analyzePageSpeed(url);
  const rankscore = calculateRankscore(metadata, headers, structuredData, faqPresent, mobileFriendly, accessibility, speedMetrics);
  const recommendations = prioritizeQuickWins(metadata, headers, structuredData, faqPresent, mobileFriendly, accessibility, speedMetrics);

  const doc = new pdfkit();
  doc.pipe(fs.createWriteStream('report.pdf'));
  doc.fontSize(12).text(`RankScore Pro Detailed Analysis\nURL: ${url}\nRankScore: ${rankscore.total_score}/100`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Metadata: Title - ${metadata.title}, Description - ${metadata.description}`);
  doc.text(`Recommendations: ${recommendations.map(r => r.fix).join(', ')}`);
  doc.end();

  return new Promise((resolve) => {
    doc.on('finish', () => {
      const report = fs.readFileSync('report.pdf', 'base64');
      resolve({ rankscore, recommendations, report });
    });
  });
}

// SaaS Endpoints
app.post('/api/scan', authenticate, async (req, res) => {
  const { url } = req.body;
  if (!validateUrl(url)) return res.status(400).json({ error: 'Invalid URL' });

  const user = await User.findById(req.userId);
  if (user.scanCount >= user.scanLimit) return res.status(403).json({ error: 'Scan limit reached' });

  try {
    const { rankscore, recommendations, report } = await generateReport(url);
    user.scanCount += 1;
    user.scans.push({ url, report, date: new Date() });
    await user.save();
    res.json({ rankscore: rankscore.total_score, recommendations, report });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

app.get('/api/scans', authenticate, async (req, res) => {
  const user = await User.findById(req.userId);
  res.json(user.scans);
});

app.post('/api/subscribe', async (req, res) => {
  const { email, paymentMethodId } = req.body;
  try {
    const customer = await stripe.customers.create({
      email,
      payment_method: paymentMethodId,
      invoice_settings: { default_payment_method: paymentMethodId }
    });
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
    });
    const user = new User({ email, stripeCustomerId: customer.id });
    await user.save();
    const token = jwt.sign({ userId: user._id }, JWT_SECRET);

    // Add to Mailchimp SaaS audience
    try {
      const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
      await mailchimp.lists.addListMember(audienceId, {
        email_address: email,
        status: 'subscribed',
        merge_fields: { FNAME: '' },
        tags: ['RankScore Pro Subscribers']
      });
      console.log('Subscriber added to Mailchimp:', email);
    } catch (err) {
      console.error('Error adding to Mailchimp:', err.response ? err.response.text : err);
    }

    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Subscription failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
