-- Run this in your Supabase SQL editor to create the submissions table

CREATE TABLE IF NOT EXISTS checklist_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state         TEXT NOT NULL,
  state_name    TEXT NOT NULL,
  resident_name TEXT NOT NULL,
  student_id    TEXT,
  coach_email   TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  checked_items JSONB NOT NULL DEFAULT '[]',
  total_items   INTEGER NOT NULL DEFAULT 0,
  checked_count INTEGER NOT NULL DEFAULT 0,
  file_names    TEXT,
  email_subject TEXT,
  form_body     TEXT
);

-- Index for fast sorting and filtering
CREATE INDEX IF NOT EXISTS idx_submissions_state ON checklist_submissions(state);
CREATE INDEX IF NOT EXISTS idx_submissions_date  ON checklist_submissions(submitted_at DESC);

-- Enable Row Level Security (optional — allows public inserts, no public reads)
ALTER TABLE checklist_submissions ENABLE ROW LEVEL SECURITY;

-- Policy: anyone can insert (submitting a form)
CREATE POLICY "Allow public insert"
  ON checklist_submissions FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy: only authenticated users (you) can select/download
CREATE POLICY "Allow authenticated select"
  ON checklist_submissions FOR SELECT
  TO authenticated
  USING (true);
