
const https = require('https');

// ── HTTPS helper ──────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── HTML → PDF via PDFShift ───────────────────────────────
async function htmlToPDF(html, apiKey) {
  const payload = JSON.stringify({
    source: html,
    format: 'Letter',
    margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  });

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const result = await httpsPost(
    'api.pdfshift.io',
    '/v3/convert/pdf',
    {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    payload
  );

  if (result.status !== 200) {
    throw new Error(`PDFShift error ${result.status}: ${result.body.toString()}`);
  }

  // Return as base64 string
  return result.body.toString('base64');
}

// ── SendGrid send ─────────────────────────────────────────
async function sendEmail(apiKey, payload) {
  const result = await httpsPost(
    'api.sendgrid.com',
    '/v3/mail/send',
    {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    payload
  );
  return result;
}

// ── Supabase ──────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MAIN HANDLER ──────────────────────────────────────────
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

    const sgKey     = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SEND_FROM_EMAIL;
    const fromName  = process.env.SEND_FROM_NAME || '#TEACH Checklist System';
    const pdfKey    = process.env.PDFSHIFT_API_KEY;

    console.log('ENV CHECK — SENDGRID_API_KEY:', sgKey ? 'SET' : 'MISSING');
    console.log('ENV CHECK — SEND_FROM_EMAIL:', fromEmail || 'MISSING');
    console.log('ENV CHECK — PDFSHIFT_API_KEY:', pdfKey ? 'SET' : 'MISSING');

    if (!sgKey || !fromEmail) {
      throw new Error('SendGrid not configured.');
    }

    // Build attachments list
    const attachments = [];

    // 1. Generate PDF from HTML if PDFShift is configured
    let pdfGenerated = false;
    let pdfError = null;
    if (pdfKey) {
      try {
        console.log('PDFShift: starting generation, HTML length:', htmlBody.length);
        const pdfBase64 = await htmlToPDF(htmlBody, pdfKey);
        console.log('PDFShift: success, PDF base64 length:', pdfBase64.length);
        const safeName = (residentName || 'Resident').replace(/\s+/g, '_');
        attachments.push({
          content:     pdfBase64,
          filename:    `TEACH_Checklist_${state}_${safeName}.pdf`,
          type:        'application/pdf',
          disposition: 'attachment',
        });
        pdfGenerated = true;
        console.log('PDFShift: attachment added OK');
      } catch (e) {
        pdfError = e.message;
        console.error('PDFShift FAILED:', e.message);
      }
    } else {
      console.log('PDFShift: skipped — PDFSHIFT_API_KEY not set');
    }

    // 2. Add uploaded files
    for (const f of fileAttachments) {
      if (f.data && f.name) {
        attachments.push({
          content:     f.data,
          filename:    f.name,
          type:        f.type || 'application/octet-stream',
          disposition: 'attachment',
        });
      }
    }

    // Build SendGrid payload
    const payload = {
      personalizations: [{
        to: [{ email: recipientEmail }],
        cc: [{ email: coachEmail }],
        subject: emailSubject,
      }],
      from:     { email: fromEmail, name: fromName },
      reply_to: { email: coachEmail },
      content:  [
        { type: 'text/plain', value: textBody },
        { type: 'text/html',  value: htmlBody },
      ],
    };

    if (attachments.length > 0) {
      payload.attachments = attachments;
    }

    const sgResult = await sendEmail(sgKey, payload);
    console.log('SendGrid status:', sgResult.status);

    if (sgResult.status < 200 || sgResult.status >= 300) {
      throw new Error(`SendGrid error ${sgResult.status}: ${sgResult.body.toString()}`);
    }

    // Save to Supabase
    await supabase.from('checklist_submissions').insert([{
      state,
      state_name:      stateName,
      resident_name:   residentName,
      student_id:      studentId || null,
      coach_email:     coachEmail,
      recipient_email: recipientEmail,
      checked_items:   checkedItems || {},
      total_items:     totalItems || 0,
      checked_count:   checkedCount || 0,
      file_names:      fileNames || null,
      email_subject:   emailSubject,
      form_body:       textBody,
    }]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        pdfGenerated,
        pdfError,
        attachmentCount: attachments.length,
      }),
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
