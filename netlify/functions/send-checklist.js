
const https = require('https');
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
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── HTML → PDF via PDFShift ───────────────────────────────
async function htmlToPDF(html, apiKey) {
  const fullWidthHtml = html
    .replace('width="620"', 'width="100%"')
    .replace('max-width:620px', 'max-width:100%')
    .replace('<td align="center">', '<td>')
    .replace('background:#f5f5f5;padding:20px 0', 'background:#ffffff;padding:0');

  const payload = JSON.stringify({
    source: fullWidthHtml,
    format: 'Letter',
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  });

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const result = await httpsPost(
    'api.pdfshift.io', '/v3/convert/pdf',
    { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    payload
  );

  console.log('PDFShift response status:', result.status);
  if (result.status !== 200) {
    throw new Error(`PDFShift error ${result.status}: ${result.body.toString().substring(0, 200)}`);
  }
  return result.body; // Buffer
}

// ── Upload file to Supabase Storage ──────────────────────
async function uploadToStorage(fileBuffer, storagePath, mimeType) {
  const { data, error } = await supabase.storage
    .from('checklist-files')
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: true, // overwrite if resubmitted
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return data.path;
}

// ── Generate signed URL for a stored file ────────────────
async function getSignedUrl(storagePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from('checklist-files')
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

// ── SendGrid send ─────────────────────────────────────────
async function sendEmail(apiKey, payload) {
  return await httpsPost(
    'api.sendgrid.com', '/v3/mail/send',
    { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    payload
  );
}

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

    console.log('ENV — SENDGRID:', sgKey ? 'SET' : 'MISSING');
    console.log('ENV — FROM_EMAIL:', fromEmail || 'MISSING');
    console.log('ENV — PDFSHIFT:', pdfKey ? 'SET' : 'MISSING');

    if (!sgKey || !fromEmail) throw new Error('SendGrid not configured.');

    // ── Safe folder name for storage ───────────────────
    const safeName  = (residentName || 'Unknown').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const safeId    = (studentId || 'NOID').replace(/[^a-zA-Z0-9_\-]/g, '_');
    const timestamp = new Date().toISOString().slice(0, 10);
    const folder    = `${state}/${safeName}_${safeId}_${timestamp}`;

    // ── 1. Generate PDF ────────────────────────────────
    let pdfBuffer   = null;
    let pdfGenerated = false;
    let pdfError    = null;
    let pdfStoragePath = null;

    if (pdfKey) {
      try {
        console.log('PDFShift: generating PDF...');
        pdfBuffer = await htmlToPDF(htmlBody, pdfKey);
        console.log('PDFShift: success, bytes:', pdfBuffer.length);
        pdfGenerated = true;

        // Upload PDF to storage
        pdfStoragePath = `${folder}/TEACH_Checklist_${state}_${safeName}.pdf`;
        await uploadToStorage(pdfBuffer, pdfStoragePath, 'application/pdf');
        console.log('Storage: PDF uploaded to', pdfStoragePath);
      } catch (e) {
        pdfError = e.message;
        console.error('PDF error:', e.message);
      }
    }

    // ── 2. Upload user-uploaded files to storage ───────
    const storedFiles = [];
    for (const f of fileAttachments) {
      if (!f.data || !f.name) continue;
      try {
        const fileBuffer = Buffer.from(f.data, 'base64');
        const safeFname  = f.name.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        const filePath   = `${folder}/${safeFname}`;
        await uploadToStorage(fileBuffer, filePath, f.type || 'application/octet-stream');
        storedFiles.push({ name: f.name, path: filePath, type: f.type });
        console.log('Storage: uploaded', filePath);
      } catch (e) {
        console.warn('Storage upload failed for', f.name, e.message);
      }
    }

    // ── 3. Build SendGrid email ────────────────────────
    const attachments = [];

    if (pdfBuffer) {
      attachments.push({
        content:     pdfBuffer.toString('base64'),
        filename:    `TEACH_Checklist_${state}_${safeName}.pdf`,
        type:        'application/pdf',
        disposition: 'attachment',
      });
    }

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

    const sgPayload = {
      personalizations: [{
        to: [{ email: recipientEmail }],
        ...(coachEmail.toLowerCase() !== recipientEmail.toLowerCase() && {
          cc: [{ email: coachEmail }]
        }),
        subject: emailSubject,
      }],
      from:     { email: fromEmail, name: fromName },
      reply_to: { email: coachEmail },
      content: [
        { type: 'text/plain', value: textBody },
        { type: 'text/html',  value: htmlBody },
      ],
    };

    if (attachments.length > 0) sgPayload.attachments = attachments;

    const sgResult = await sendEmail(sgKey, sgPayload);
    console.log('SendGrid status:', sgResult.status);

    if (sgResult.status < 200 || sgResult.status >= 300) {
      throw new Error(`SendGrid error ${sgResult.status}: ${sgResult.body.toString()}`);
    }

    // ── 4. Save to Supabase database ───────────────────
    const allStoredPaths = [];
    if (pdfStoragePath) allStoredPaths.push(pdfStoragePath);
    storedFiles.forEach(f => allStoredPaths.push(f.path));

    const { error: dbError } = await supabase.from('checklist_submissions').insert([{
      state,
      state_name:      stateName,
      resident_name:   residentName,
      student_id:      studentId || null,
      coach_email:     coachEmail,
      recipient_email: recipientEmail,
      checked_items:   checkedItems || {},
      total_items:     totalItems || 0,
      checked_count:   checkedCount || 0,
      file_names:      fileAttachments.map(f => f.name).join(', ') || null,
      email_subject:   emailSubject,
      form_body:       textBody,
      storage_folder:  folder,
      storage_paths:   allStoredPaths,
    }]);

    if (dbError) console.warn('DB insert error:', dbError.message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        pdfGenerated,
        pdfError,
        storedFileCount: allStoredPaths.length,
        storageFolder: folder,
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


