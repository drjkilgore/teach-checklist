const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Simple token check — set DOWNLOAD_TOKEN in Netlify env vars
  const token = event.queryStringParameters && event.queryStringParameters.token;
  if (!token || token !== process.env.DOWNLOAD_TOKEN) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  try {
    const { data, error } = await supabase
      .from('checklist_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('Fetch submissions error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
