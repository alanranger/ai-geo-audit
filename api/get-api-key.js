// Vercel Serverless Function to return API key from environment variable
// This keeps the API key secure and not exposed in client-side code

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get API key from Vercel environment variable
  const apiKey = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;

  if (!apiKey) {
    return res.status(404).json({ error: 'API key not configured' });
  }

  // Return the API key
  return res.status(200).json({ apiKey });
}
