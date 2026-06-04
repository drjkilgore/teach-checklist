// Looks up a submission by magic link token for the advisor completion page
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const token = event.queryStringParameters?.token;

  if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No token provided.' }) };

  try {
    const { data: sub, error } = await supabase
      .from('checklist_submissions')
      .select('id,state,state_name,resident_name,student_id,coach_email,advisor_email,checked_items,total_items,checked_count,status,token_expires,file_names')
      .eq('completion_token', token)
      .single();

    if (error || !sub) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Invalid or expired link.' }) };
    if (sub.status === 'fully_complete') return { statusCode: 200, headers, body: JSON.stringify({ alreadyComplete: true, residentName: sub.resident_name, state: sub.state }) };
    if (sub.token_expires && new Date(sub.token_expires) < new Date()) return { statusCode: 410, headers, body: JSON.stringify({ error: 'This link has expired. Please contact the coach.' }) };

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission: sub }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
