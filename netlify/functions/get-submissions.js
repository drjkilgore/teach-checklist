const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verifyToken(token) {
  try {
    const salt = process.env.PASSWORD_SALT || 'teach-checklist-salt-2026';
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', salt).update(data).digest('hex');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(data, 'base64').toString());
  } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  // Support both old download token and new coach JWT
  let stateFilter = null;
  if (token === process.env.DOWNLOAD_TOKEN) {
    // Admin download token — see all
    stateFilter = null;
  } else {
    const coach = verifyToken(token);
    if (!coach || coach.exp < Date.now()) return { statusCode: 401, body: 'Unauthorized' };
    if (coach.role !== 'admin') stateFilter = coach.states;
  }

  try {
    let query = supabase.from('checklist_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (stateFilter) query = query.in('state', stateFilter);

    const { data, error } = await query;
    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
