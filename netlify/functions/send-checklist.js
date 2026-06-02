
const https = require('https');

function sendGridRequest(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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
    const {
      state, stateName, residentName, studentId,
      coachEmail, recipientEmail,
      checkedCount, totalItems,
      fileAttachments = [],
      emailSubject, htmlBody, textBody,
      checkedItems, fileNames,
    } = data;

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SEND_FROM_EMAIL;
    const fromName = process.env.SEND_FROM_NAME || '#TEACH Checklist System';

    if (!apiKey || !fromEmail) {
      throw new Error('SendGrid not configured. Set SENDGRID_API_KEY and SEND_FROM_EMAIL in Netlify env vars.');
    }

    // Build SendGrid payload
    const payload = {
      personalizations: [{
        to: [{ email: recipientEmail }],
        cc: [{ email: coachEmail }],
        subject: emailSubject,
      }],
      from: { email: fromEmail, name: fromName },
      reply_to: { email: coachEmail },
      content: [
        { type: 'text/plain', value: textBody },
        { type: 'text/html',  value: htmlBody },
      ],
    };

    // Add attachments — SendGrid handles all file types perfectly
    if (fileAttachments.length > 0) {
      payload.attachments = fileAttachments.map(f => ({
        content: f.data,          // raw base64, no prefix needed
        filename: f.name,
        type: f.type || 'application/octet-stream',
        disposition: 'attachment',
      }));
    }

    const result = await sendGridRequest(apiKey, payload);
    console.log('SendGrid response:', result.status, result.body);

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`SendGrid error ${result.status}: ${result.body}`);
    }

    // Save to Supabase
    await supabase.from('checklist_submissions').insert([{
      state, state_name: stateName,
      resident_name: residentName,
      student_id: studentId || null,
      coach_email: coachEmail,
      recipient_email: recipientEmail,
      checked_items: checkedItems || {},
      total_items: totalItems || 0,
      checked_count: checkedCount || 0,
      file_names: fileNames || null,
      email_subject: emailSubject,
      form_body: textBody,
    }]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };

  } catch (err) {
    console.error('send-checklist error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
