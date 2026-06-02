const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Simple password hashing
function hashPassword(password) {
  const salt = process.env.PASSWORD_SALT || 'teach-checklist-salt-2026';
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

// Simple JWT-like token (base64 encoded JSON + signature)
function createToken(payload) {
  const salt = process.env.PASSWORD_SALT || 'teach-checklist-salt-2026';
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig  = crypto.createHmac('sha256', salt).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  try {
    const salt = process.env.PASSWORD_SALT || 'teach-checklist-salt-2026';
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', salt).update(data).digest('hex');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(data, 'base64').toString());
  } catch { return null; }
}

async function sendEmail(to, subject, html) {
  const https = require('https');
  const body = JSON.stringify({
    personalizations: [{ to: [{ email: to }], subject }],
    from: { email: process.env.SEND_FROM_EMAIL, name: '#TEACH Checklist System' },
    content: [{ type: 'text/html', value: html }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.sendgrid.com', path: '/v3/mail/send', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => { resolve(res.statusCode); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const headers = { 'Content-Type': 'application/json' };
  const ok  = (data) => ({ statusCode: 200, headers, body: JSON.stringify({ success: true,  ...data }) });
  const err = (msg)  => ({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: msg }) });

  try {
    const { action, ...params } = JSON.parse(event.body);

    // ── SIGNUP ──────────────────────────────────────────
    if (action === 'signup') {
      const { email, name, password, states } = params;
      if (!email || !name || !password || !states?.length)
        return err('All fields are required.');

      const existing = await supabase.from('coaches').select('id').eq('email', email.toLowerCase()).single();
      if (existing.data) return err('An account with this email already exists.');

      const { error } = await supabase.from('coaches').insert([{
        email:         email.toLowerCase().trim(),
        name:          name.trim(),
        password_hash: hashPassword(password),
        states,
        role:   'coach',
        status: 'pending',
      }]);
      if (error) throw error;

      // Email admin
      const adminEmail = process.env.ADMIN_EMAIL || process.env.SEND_FROM_EMAIL;
      const appUrl = process.env.APP_URL || 'https://teach-checklist.netlify.app';
      await sendEmail(adminEmail,
        `New coach signup: ${name}`,
        `<p><strong>${name}</strong> (${email}) has requested a coach account.</p>
         <p>States: ${states.join(', ')}</p>
         <p><a href="${appUrl}/admin">Go to Admin Panel to approve or deny.</a></p>`
      ).catch(e => console.warn('Admin notify failed:', e));

      return ok({ message: 'Account created. You will receive an email when approved.' });
    }

    // ── LOGIN ───────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = params;
      const { data: coach, error } = await supabase.from('coaches')
        .select('id,email,name,states,role,status,password_hash')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (error || !coach) return err('Invalid email or password.');
      if (coach.status === 'pending')   return err('Your account is pending approval.');
      if (coach.status === 'suspended') return err('Your account has been suspended.');
      if (coach.password_hash !== hashPassword(password)) return err('Invalid email or password.');

      const token = createToken({
        id: coach.id, email: coach.email, name: coach.name,
        states: coach.states, role: coach.role,
        exp: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
      });

      return ok({ token, coach: { id: coach.id, email: coach.email, name: coach.name, states: coach.states, role: coach.role } });
    }

    // ── VERIFY TOKEN ────────────────────────────────────
    if (action === 'verify') {
      const payload = verifyToken(params.token);
      if (!payload || payload.exp < Date.now()) return err('Session expired. Please log in again.');
      return ok({ coach: { id: payload.id, email: payload.email, name: payload.name, states: payload.states, role: payload.role } });
    }

    // ── RESET REQUEST ───────────────────────────────────
    if (action === 'reset_request') {
      const { email } = params;
      const { data: coach } = await supabase.from('coaches').select('id,name').eq('email', email.toLowerCase()).single();
      if (!coach) return ok({ message: 'If that email exists, a reset link has been sent.' }); // Don't reveal existence

      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await supabase.from('coaches').update({ reset_token: token, reset_expires: expires.toISOString() }).eq('id', coach.id);

      const appUrl = process.env.APP_URL || 'https://teach-checklist.netlify.app';
      await sendEmail(email,
        '#TEACH — Password Reset',
        `<p>Hi ${coach.name},</p>
         <p>Click the link below to reset your password. This link expires in 1 hour.</p>
         <p><a href="${appUrl}/?reset=${token}" style="background:#002E5D;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Reset Password</a></p>
         <p>If you did not request this, you can ignore this email.</p>`
      );

      return ok({ message: 'If that email exists, a reset link has been sent.' });
    }

    // ── RESET PASSWORD ──────────────────────────────────
    if (action === 'reset_password') {
      const { token, password } = params;
      const { data: coach } = await supabase.from('coaches')
        .select('id,reset_expires')
        .eq('reset_token', token)
        .single();

      if (!coach) return err('Invalid or expired reset link.');
      if (new Date(coach.reset_expires) < new Date()) return err('Reset link has expired. Please request a new one.');

      await supabase.from('coaches').update({
        password_hash: hashPassword(password),
        reset_token:   null,
        reset_expires: null,
      }).eq('id', coach.id);

      return ok({ message: 'Password reset successfully. You can now log in.' });
    }

    // ── ADMIN: GET ALL COACHES ───────────────────────────
    if (action === 'get_coaches') {
      const payload = verifyToken(params.token);
      if (!payload || payload.role !== 'admin') return err('Unauthorized');

      const { data, error } = await supabase.from('coaches')
        .select('id,email,name,states,role,status,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ok({ coaches: data });
    }

    // ── ADMIN: UPDATE COACH ──────────────────────────────
    if (action === 'update_coach') {
      const payload = verifyToken(params.token);
      if (!payload || payload.role !== 'admin') return err('Unauthorized');

      const { coachId, updates } = params;
      const allowed = {};
      if (updates.status) allowed.status = updates.status;
      if (updates.role)   allowed.role   = updates.role;
      if (updates.states) allowed.states = updates.states;
      if (updates.name)   allowed.name   = updates.name;

      const { error } = await supabase.from('coaches').update(allowed).eq('id', coachId);
      if (error) throw error;

      // Notify coach of approval
      if (updates.status === 'active') {
        const { data: coach } = await supabase.from('coaches').select('email,name').eq('id', coachId).single();
        if (coach) {
          const appUrl = process.env.APP_URL || 'https://teach-checklist.netlify.app';
          await sendEmail(coach.email,
            '#TEACH — Your account has been approved',
            `<p>Hi ${coach.name},</p>
             <p>Your #TEACH coach account has been approved. You can now log in at:</p>
             <p><a href="${appUrl}">${appUrl}</a></p>`
          ).catch(e => console.warn('Approval email failed:', e));
        }
      }

      return ok({ message: 'Coach updated.' });
    }

    return err('Unknown action.');

  } catch (e) {
    console.error('coach-auth error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
