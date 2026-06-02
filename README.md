# #TEACH Resident Completion Checklist

A branded, Netlify-deployed completion checklist app for #TEACH residents across AL, AZ, IN, MI, and NC — with Supabase database logging and Excel export.

---

## Tech Stack

| Layer | Service |
|-------|---------|
| Hosting | Netlify |
| Serverless functions | Netlify Functions (Node.js) |
| Database | Supabase (Postgres) |
| Excel export | SheetJS (client-side) |
| Version control | GitHub |

---

## Setup (Step-by-Step)

### 1. Supabase — Create the database table

1. Go to your Supabase project → **SQL Editor**
2. Paste and run the contents of `supabase_setup.sql`
3. This creates the `checklist_submissions` table with proper indexes and Row Level Security policies

---

### 2. GitHub — Push the project

```bash
git init
git add .
git commit -m "Initial commit — #TEACH checklist app"
git remote add origin https://github.com/YOUR_USERNAME/teach-checklist.git
git push -u origin main
```

---

### 3. Netlify — Connect and deploy

1. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
2. Select your GitHub repo
3. Build settings are auto-detected from `netlify.toml`:
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
4. Click **Deploy site**

---

### 4. Netlify — Set environment variables

In Netlify → Site settings → **Environment variables**, add:

| Variable | Value | Notes |
|----------|-------|-------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | From Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | **Service role** key (not anon key) — keep secret |
| `DOWNLOAD_TOKEN` | Any strong password | Used to authorize Excel downloads |

> ⚠️ Use the **service role** key (not the anon key) for the Netlify function so it can bypass RLS and read all rows.

---

### 5. Install dependencies

Netlify auto-installs from `package.json` during build. For local dev:

```bash
npm install
npx netlify dev   # Runs site + functions locally on http://localhost:8888
```

---

## Features

### Checklist App
- Select state (AL, AZ, IN, MI, NC) — each has state-specific requirements
- Enter resident name + student ID
- Complete all 10 checklist sections with state-specific items
- Upload supporting documents
- Review summary with completion percentage
- Submit → saves to Supabase + opens email client with pre-filled form

### Email
- Opens your default email client with the completed checklist pre-filled
- Recipient: the email you specify
- CC: your coach email (auto-filled)
- Body: exact checklist format matching the original PDFs

### Excel Export (Download Panel)
- Available after submission on the confirmation screen
- Enter your `DOWNLOAD_TOKEN` 
- Downloads `TEACH_Submissions_YYYY-MM-DD.xlsx` with:
  - **Sheet 1 "Submissions"**: All records with resident name, student ID, state, emails, completion %, file names, date
  - **Sheet 2 "By State"**: Submission count by state + total

---

## File Structure

```
teach-checklist/
├── netlify.toml                    # Netlify config
├── package.json                    # Node dependencies
├── supabase_setup.sql              # Run once in Supabase SQL editor
├── public/
│   └── index.html                  # Main app (HTML/CSS/JS, no build step)
└── netlify/
    └── functions/
        ├── save-submission.js      # POST — saves record to Supabase
        └── get-submissions.js      # GET — fetches all records (token-protected)
```

---

## Adding the Download Token Anywhere

You can also add a standalone download page. Just create `public/download.html` with:

```html
<!DOCTYPE html>
<html><body>
<input type="password" id="tok" placeholder="Token">
<button onclick="dl()">Download Excel</button>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script>
async function dl() {
  const res = await fetch('/.netlify/functions/get-submissions?token=' + document.getElementById('tok').value);
  const rows = await res.json();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Submissions');
  XLSX.writeFile(wb, 'TEACH_Submissions.xlsx');
}
</script>
</body></html>
```

---

## Updating Checklist Items

All checklist content is in the `STATES` object inside `public/index.html`. Each state has:
- `s3`: State Assessments and Requirements (state-specific)
- `s4`: Documentation and Conversations (state-specific)
- `s8`: Section 8 items (state-specific)
- `s9`: Professional license name and label
- `bgCheck`: Background check text
- `noMentor`: true = skip Mentor Assessment item in section 2

No build step needed — just edit the HTML file and push to GitHub. Netlify auto-deploys.

---

## Security Notes

- The `SUPABASE_SERVICE_KEY` is never exposed to the browser — it only lives in Netlify's server environment
- The Excel download endpoint requires the `DOWNLOAD_TOKEN` — set a strong value (20+ characters)
- Row Level Security in Supabase ensures anonymous users can only insert, not read records directly
- Consider adding Netlify Identity if you want a proper login gate on the app itself
