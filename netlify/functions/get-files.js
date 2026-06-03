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
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const headers = { 'Content-Type': 'application/json' };

  try {
    const { token, submissionId, storagePaths } = JSON.parse(event.body);

    // Verify session
    const coach = verifyToken(token);
    if (!coach || coach.exp < Date.now()) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // If specific paths provided, generate signed URLs for those
    if (storagePaths && storagePaths.length > 0) {
      // Verify coach has access to these files (check state prefix)
      const allowedPaths = storagePaths.filter(p => {
        if (coach.role === 'admin') return true;
        // Path format: STATE/residentName_id_date/filename
        const fileState = p.split('/')[0];
        return coach.states.includes(fileState);
      });

      const urls = await Promise.all(
        allowedPaths.map(async (path) => {
          const { data, error } = await supabase.storage
            .from('checklist-files')
            .createSignedUrl(path, 3600); // 1 hour expiry
          return {
            path,
            name: path.split('/').pop(),
            url: error ? null : data.signedUrl,
            error: error ? error.message : null,
          };
        })
      );

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, files: urls }) };
    }

    // If submission ID provided, look up its stored paths
    if (submissionId) {
      const { data: sub, error } = await supabase
        .from('checklist_submissions')
        .select('storage_paths, state, resident_name, student_id')
        .eq('id', submissionId)
        .single();

      if (error || !sub) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Submission not found' }) };
      }

      // Check state access
      if (coach.role !== 'admin' && !coach.states.includes(sub.state)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Access denied' }) };
      }

      if (!sub.storage_paths || sub.storage_paths.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, files: [] }) };
      }

      const urls = await Promise.all(
        sub.storage_paths.map(async (path) => {
          const { data, error } = await supabase.storage
            .from('checklist-files')
            .createSignedUrl(path, 3600);
          return {
            path,
            name: path.split('/').pop(),
            url: error ? null : data.signedUrl,
          };
        })
      );

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, files: urls }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide submissionId or storagePaths' }) };

  } catch (err) {
    console.error('get-files error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
