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

function isAuthorized(token) {
  // Accept the static download token
  if (token === process.env.DOWNLOAD_TOKEN) return true;
  // Accept a valid admin JWT
  const payload = verifyToken(token);
  if (payload && payload.role === 'admin' && payload.exp > Date.now()) return true;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = event.queryStringParameters && event.queryStringParameters.token;
  if (!token || !isAuthorized(token)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { ids } = JSON.parse(event.body);

    let error;
    if (ids === 'ALL') {
      ({ error } = await supabase
        .from('checklist_submissions')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'));
    } else if (Array.isArray(ids) && ids.length > 0) {
      ({ error } = await supabase
        .from('checklist_submissions')
        .delete()
        .in('id', ids));
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'No IDs provided' }) };
    }

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('delete-submissions error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
