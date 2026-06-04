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
  const ok  = (d) => ({ statusCode: 200, headers, body: JSON.stringify({ success: true,  ...d }) });
  const err = (m) => ({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: m }) });

  try {
    const { action, token, ...params } = JSON.parse(event.body);

    // Verify coach session for all actions
    const coach = verifyToken(token);
    if (!coach || coach.exp < Date.now()) return err('Session expired. Please log in again.');

    // ── SAVE DRAFT ───────────────────────────────────────
    if (action === 'save') {
      const { studentId, state, stateName, residentName, coachEmail, recipientEmail, ccEmails = [], formData } = params;
      if (!studentId) return err('Student ID is required to save a draft.');

      // Check coach has access to this state
      if (coach.role !== 'admin' && !coach.states.includes(state)) return err('You do not have access to this state.');

      // Check if draft already exists for this student ID
      const { data: existing } = await supabase.from('checklist_drafts')
        .select('id').eq('student_id', studentId).eq('state', state).single();

      if (existing) {
        // Update existing draft
        const { error } = await supabase.from('checklist_drafts').update({
          resident_name:   residentName,
          coach_id:        coach.id,
          coach_email:     coachEmail,
          recipient_email: recipientEmail,
          form_data:       { ...(formData||{}), cc_emails: ccEmails },
        }).eq('id', existing.id);
        if (error) throw error;
        return ok({ message: 'Draft updated.', draftId: existing.id });
      } else {
        // Create new draft
        const { data, error } = await supabase.from('checklist_drafts').insert([{
          student_id:      studentId,
          coach_id:        coach.id,
          state,
          state_name:      stateName,
          resident_name:   residentName,
          coach_email:     coachEmail,
          recipient_email: recipientEmail,
          form_data:       { ...(formData||{}), cc_emails: ccEmails },
        }]).select('id').single();
        if (error) throw error;
        return ok({ message: 'Draft saved.', draftId: data.id });
      }
    }

    // ── LOAD DRAFT BY STUDENT ID ─────────────────────────
    if (action === 'load') {
      const { studentId } = params;
      if (!studentId) return err('Student ID is required.');

      const query = supabase.from('checklist_drafts')
        .select('*')
        .eq('student_id', studentId);

      // Non-admins only see drafts for their states
      if (coach.role !== 'admin') {
        query.in('state', coach.states);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) return ok({ draft: null });

      // Return most recently updated
      const draft = data.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
      return ok({ draft });
    }

    // ── GET ALL DRAFTS (for admin panel) ──────────────────
    if (action === 'get_all') {
      let query = supabase.from('checklist_drafts')
        .select('id,student_id,state,state_name,resident_name,coach_email,created_at,updated_at')
        .order('updated_at', { ascending: false });

      if (coach.role !== 'admin') {
        query = query.in('state', coach.states);
      }

      const { data, error } = await query;
      if (error) throw error;
      return ok({ drafts: data || [] });
    }

    // ── DELETE DRAFT ─────────────────────────────────────
    if (action === 'delete') {
      const { draftId } = params;
      const { error } = await supabase.from('checklist_drafts').delete().eq('id', draftId);
      if (error) throw error;
      return ok({ message: 'Draft deleted.' });
    }

    return err('Unknown action.');

  } catch (e) {
    console.error('draft error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};

