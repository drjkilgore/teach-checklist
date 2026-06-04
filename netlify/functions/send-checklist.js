const https   = require('https');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── HTTPS helper ──────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.write(bodyStr); req.end();
  });
}

// ── PDFShift ──────────────────────────────────────────────
async function htmlToPDF(html, apiKey) {
  const fullWidthHtml = html
    .replace('width="620"', 'width="100%"')
    .replace('max-width:620px', 'max-width:100%')
    .replace('<td align="center">', '<td>')
    .replace('background:#f5f5f5;padding:20px 0', 'background:#ffffff;padding:0');
  const payload = JSON.stringify({
    source: fullWidthHtml, format: 'Letter',
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  });
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const result = await httpsPost('api.pdfshift.io', '/v3/convert/pdf',
    { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }, payload);
  console.log('PDFShift status:', result.status);
  if (result.status !== 200) throw new Error(`PDFShift error ${result.status}: ${result.body.toString().substring(0,200)}`);
  return result.body;
}

// ── Supabase Storage ──────────────────────────────────────
async function uploadToStorage(buffer, path, mime) {
  const { data, error } = await supabase.storage.from('checklist-files')
    .upload(path, buffer, { contentType: mime, upsert: true });
  if (error) throw new Error(`Storage error: ${error.message}`);
  return data.path;
}

// ── SendGrid ──────────────────────────────────────────────
async function sendEmail(apiKey, payload) {
  return httpsPost('api.sendgrid.com', '/v3/mail/send',
    { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, payload);
}

async function deliverEmail({ to, cc, subject, html, text, attachments, fromEmail, fromName, coachEmail }) {
  const sgKey = process.env.SENDGRID_API_KEY;
  const personalization = {
    to: [{ email: to }],
    subject,
  };
  if (cc && cc.toLowerCase() !== to.toLowerCase()) {
    personalization.cc = [{ email: cc }];
  }
  const payload = {
    personalizations: [personalization],
    from: { email: fromEmail, name: fromName },
    reply_to: { email: coachEmail || fromEmail },
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html',  value: html },
    ],
  };
  if (attachments && attachments.length) payload.attachments = attachments;
  const result = await sendEmail(sgKey, payload);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`SendGrid error ${result.status}: ${result.body.toString()}`);
  }
  return result;
}

// ── Build completion link email HTML ─────────────────────
function buildAdvisorEmail({ residentName, studentId, state, stateName, coachEmail, completionUrl, htmlChecklist, coachItems }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:16px 0">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:680px">
  <tr><td style="background:#002E5D;padding:16px 24px">
    <div style="font-size:22px;font-weight:900;color:#fff"><span style="color:#C5C5C5">#</span>TEACH</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:2px">Resident Completion Checklist — Action Required</div>
  </td></tr>
  <tr><td style="padding:20px 24px">
    <p style="font-size:14px;color:#1a1a1a;margin:0 0 12px">
      A resident completion checklist has been submitted by the instructional coach and requires your review and completion.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#EBF5FB;border:1px solid #B3DEF5;border-radius:6px;padding:12px;margin-bottom:16px">
      <tr>
        <td style="font-size:13px;color:#002E5D;padding:4px 8px"><strong>Resident:</strong> ${residentName}${studentId ? ` (${studentId})` : ''}</td>
        <td style="font-size:13px;color:#002E5D;padding:4px 8px"><strong>State:</strong> ${state} — ${stateName}</td>
      </tr>
      <tr>
        <td colspan="2" style="font-size:13px;color:#002E5D;padding:4px 8px"><strong>Submitted by coach:</strong> ${coachEmail}</td>
      </tr>
    </table>
    <p style="font-size:13px;color:#555;margin:0 0 16px">
      The coach has completed their portion (Sections 1, 2, and the final coaching conversation in Section 4).
      Please complete the remaining items and finalize the checklist using the button below.
    </p>
    <div style="text-align:center;margin:24px 0">
      <a href="${completionUrl}" style="background:#002E5D;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:6px;font-size:15px;font-weight:700;display:inline-block;letter-spacing:0.3px">
        ✓ Complete Your Portion
      </a>
      <p style="font-size:11px;color:#888;margin-top:10px">This link expires in 30 days.</p>
    </div>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="font-size:12px;color:#888;margin:0 0 8px"><strong>Coach's completed items are shown below for reference:</strong></p>
    ${htmlChecklist}
  </td></tr>
  <tr><td style="background:#002E5D;padding:10px 24px">
    <span style="font-size:10px;color:rgba(255,255,255,0.5)">Confidential – Internal Use Only · #TEACH Checklist System</span>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── MAIN HANDLER ──────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const data = JSON.parse(event.body);
    const {
      state, stateName, residentName, studentId,
      coachEmail, recipientEmail,
      checkedCount, totalItems,
      fileAttachments = [],
      emailSubject, htmlBody, textBody,
      checkedItems, fileNames,
      stage = 'coach', // 'coach' | 'advisor'
      submissionId,    // for advisor stage update
    } = data;

    const sgKey     = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SEND_FROM_EMAIL;
    const fromName  = process.env.SEND_FROM_NAME || '#TEACH Checklist System';
    const pdfKey    = process.env.PDFSHIFT_API_KEY;
    const appUrl    = process.env.APP_URL || 'https://teach-checklist.netlify.app';

    if (!sgKey || !fromEmail) throw new Error('SendGrid not configured.');

    const safeName = (residentName || 'Unknown').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const safeId   = (studentId || 'NOID').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const dateStr  = new Date().toISOString().slice(0, 10);
    const folder   = `${state}/${safeName}_${safeId}_${dateStr}`;

    // ── STAGE 1: COACH SUBMISSION ──────────────────────
    if (stage === 'coach') {

      // Generate magic link token (30 day expiry)
      const token   = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const completionUrl = `${appUrl}/complete?token=${token}`;

      // Upload coach's files to storage
      const storedPaths = [];
      for (const f of fileAttachments) {
        if (!f.data || !f.name) continue;
        try {
          const buf = Buffer.from(f.data, 'base64');
          const p   = `${folder}/${f.name.replace(/[^a-zA-Z0-9_\-\.]/g, '_')}`;
          await uploadToStorage(buf, p, f.type || 'application/octet-stream');
          storedPaths.push(p);
        } catch(e) { console.warn('Storage upload failed:', f.name, e.message); }
      }

      // Save submission to DB with status coach_complete
      const { data: sub, error: dbErr } = await supabase
        .from('checklist_submissions')
        .insert([{
          state, state_name: stateName, resident_name: residentName,
          student_id: studentId || null, coach_email: coachEmail,
          recipient_email: recipientEmail, checked_items: checkedItems || {},
          total_items: totalItems || 0, checked_count: checkedCount || 0,
          file_names: fileAttachments.map(f => f.name).join(', ') || null,
          email_subject: emailSubject, form_body: textBody,
          storage_folder: folder, storage_paths: storedPaths,
          status: 'coach_complete',
          completion_token: token,
          token_expires: expires.toISOString(),
          advisor_email: recipientEmail,
        }])
        .select('id')
        .single();

      if (dbErr) throw new Error('DB error: ' + dbErr.message);

      // Build attachments for the coach's email
      const attachments = [];
      for (const f of fileAttachments) {
        if (f.data && f.name) {
          attachments.push({ content: f.data, filename: f.name, type: f.type || 'application/octet-stream', disposition: 'attachment' });
        }
      }

      // Send email to advisor with magic link
      const advisorHtml = buildAdvisorEmail({
        residentName, studentId, state, stateName, coachEmail,
        completionUrl, htmlChecklist: htmlBody,
      });

      await deliverEmail({
        to: recipientEmail, cc: coachEmail,
        subject: `Action Required: Complete Checklist — ${residentName}${studentId ? ` (${studentId})` : ''} — ${state}`,
        html: advisorHtml,
        text: `Please complete the resident checklist for ${residentName}. Use this link: ${completionUrl}`,
        attachments,
        fromEmail, fromName, coachEmail,
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, stage: 'coach', submissionId: sub.id }),
      };
    }

    // ── STAGE 2: ADVISOR COMPLETION ────────────────────
    if (stage === 'advisor') {
      const { advisorCheckedItems } = data;

      // Fetch existing submission
      const { data: sub, error: fetchErr } = await supabase
        .from('checklist_submissions')
        .select('*')
        .eq('id', submissionId)
        .single();

      if (fetchErr || !sub) throw new Error('Submission not found.');
      if (sub.status === 'fully_complete') throw new Error('This checklist has already been completed.');

      // Merge coach + advisor items
      const allChecked = { ...sub.checked_items, ...advisorCheckedItems };
      const allTotal   = totalItems || sub.total_items;
      const allCount   = Object.values(allChecked).filter(Boolean).length;

      // Generate the fully completed PDF
      let pdfBuffer = null, pdfGenerated = false, pdfError = null, pdfPath = null;
      if (pdfKey) {
        try {
          pdfBuffer    = await htmlToPDF(htmlBody, pdfKey);
          pdfGenerated = true;
          pdfPath      = `${sub.storage_folder || folder}/TEACH_Checklist_${state}_${safeName}_FINAL.pdf`;
          await uploadToStorage(pdfBuffer, pdfPath, 'application/pdf');
          console.log('Final PDF stored at', pdfPath);
        } catch(e) {
          pdfError = e.message;
          console.error('PDF error:', e.message);
        }
      }

      // Update submission record
      const allPaths = [...(sub.storage_paths || [])];
      if (pdfPath) allPaths.push(pdfPath);

      await supabase.from('checklist_submissions').update({
        status:               'fully_complete',
        advisor_items:        advisorCheckedItems,
        checked_items:        allChecked,
        checked_count:        allCount,
        advisor_completed_at: new Date().toISOString(),
        completion_token:     null, // invalidate token
        token_expires:        null,
        storage_paths:        allPaths,
      }).eq('id', submissionId);

      // Build final email with PDF
      const pdfAttachments = [];
      if (pdfBuffer) {
        pdfAttachments.push({
          content:     pdfBuffer.toString('base64'),
          filename:    `TEACH_Checklist_${state}_${safeName}_FINAL.pdf`,
          type:        'application/pdf',
          disposition: 'attachment',
        });
      }

      // Send final email back to coach + advisor
      await deliverEmail({
        to: sub.coach_email, cc: sub.advisor_email,
        subject: `✓ Checklist Complete — ${residentName}${studentId ? ` (${studentId})` : ''} — ${state}`,
        html: htmlBody,
        text: `The resident completion checklist for ${residentName} has been fully completed by the advisor.`,
        attachments: pdfAttachments,
        fromEmail, fromName, coachEmail: sub.coach_email,
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true, stage: 'advisor',
          pdfGenerated, pdfError, pdfPath,
        }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid stage.' }) };

  } catch (err) {
    console.error('send-checklist error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};



