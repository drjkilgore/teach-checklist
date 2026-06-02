const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = event.queryStringParameters && event.queryStringParameters.token;
  if (!token || token !== process.env.DOWNLOAD_TOKEN) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { ids } = JSON.parse(event.body);

    let error;
    if (ids === 'ALL') {
      // Delete everything
      ({ error } = await supabase
        .from('checklist_submissions')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')); // delete all rows
    } else if (Array.isArray(ids) && ids.length > 0) {
      // Delete specific IDs
      ({ error } = await supabase
        .from('checklist_submissions')
        .delete()
        .in('id', ids));
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No IDs provided' })
      };
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
