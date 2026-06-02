const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    const { error } = await supabase
      .from('checklist_submissions')
      .insert([{
        state:           data.state,
        state_name:      data.stateName,
        resident_name:   data.residentName,
        student_id:      data.studentId || null,
        coach_email:     data.coachEmail,
        recipient_email: data.recipientEmail,
        checked_items:   data.checkedItems,
        total_items:     data.totalItems,
        checked_count:   data.checkedCount,
        file_names:      data.fileNames || null,
        email_subject:   data.emailSubject || null,
        form_body:       data.formBody || null,
      }]);

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Save submission error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
