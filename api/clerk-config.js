export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const publishableKey = String(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim();
  if (!publishableKey) return res.status(503).json({ error: 'Clerk is not configured' });
  return res.status(200).json({ publishableKey });
}
