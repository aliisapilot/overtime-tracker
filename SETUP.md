# Setup Guide for New Windows Laptop

## Prerequisites Installation

### 1. Install Git
```powershell
winget install Git.Git
# Or download from https://git-scm.com/download/win
```
Verify: `git --version`

### 2. Install Node.js (LTS)
```powershell
winget install OpenJS.NodeJS.LTS
# Or download from https://nodejs.org/
```
Verify: `node --version` (should be 18+)
Verify: `npm --version`

### 3. Install VS Code (Optional but Recommended)
```powershell
winget install Microsoft.VisualStudioCode
```

### 4. Install Kilo Code Extension (if using)
- Open VS Code
- Extensions → Search "Kilo Code" → Install

## Clone Repository

```powershell
# Navigate to your development folder
cd C:\dev

# Clone the private repository
git clone https://github.com/YOUR_USERNAME/overtime-tracker.git
# Or if using SSH:
git clone git@github.com:YOUR_USERNAME/overtime-tracker.git

cd overtime-tracker
```

## Frontend Setup

```powershell
cd frontend

# Install dependencies
npm install

# Copy environment template
copy .env.example .env.local

# Edit .env.local with your GAS Web App URL
notepad .env.local
```

### Required Environment Variable
Edit `.env.local`:
```env
NEXT_PUBLIC_GAS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_ACTUAL_SCRIPT_ID/exec
```

## Backend Setup (Google Apps Script)

### Option A: Use Existing Backend (Shared)
If you already have a deployed Apps Script project:
1. Get the Web App URL from the existing deployment
2. Add it to `.env.local`
3. Both laptops will use the same backend and database

### Option B: Create New Backend (For Separate Development)
If you need an isolated development backend:

1. Go to [script.google.com](https://script.google.com)
2. Click "New Project"
3. Name it "Overtime Tracker Dev - [Your Name]"

4. Create a new Google Spreadsheet:
   - Go to [sheets.google.com](https://sheets.google.com)
   - Create blank spreadsheet
   - Name it "Overtime Tracker Data - Dev"
   - Copy the Spreadsheet ID from URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

5. In Apps Script:
   - Project Settings → Enable "Chrome V8 runtime"
   - Resources → Advanced Google Services → Enable "Google Sheets API"
   - File → Project Properties → Script Properties → Add:
     - `SPREADSHEET_ID` = your spreadsheet ID

6. Copy all files from `backend/` to Apps Script:
   - `Code.gs` → Code.gs
   - `lib/Config.js` → Create file `Config.js`
   - `services/*.js` → Create each as separate script file

7. Run `init()` function to initialize sheets

8. Deploy → New Deployment:
   - Type: Web App
   - Execute as: Me
   - Who has access: Anyone
   - Copy the Web App URL

9. Update `.env.local` with new URL

## Verify Installation

### Frontend
```powershell
cd frontend
npm run dev
```
Open http://localhost:3000 - should show the dashboard

### Build Check
```powershell
npm run build
npm run lint
npx tsc --noEmit
```

### Backend Test
In Apps Script:
1. Select `doPost` function
2. Run with test event:
```json
{
  "parameter": {
    "action": "getJobSites"
  }
}
```
Should return job sites from your spreadsheet.

## Google Apps Script CLI (Optional)

For easier syncing between local files and Apps Script:

```powershell
npm install -g @google/clasp
clasp login
clasp clone YOUR_SCRIPT_ID
```

Now you can:
- `clasp pull` - Download from GAS to local
- `clasp push` - Upload local to GAS
- `clasp logs` - View execution logs

## Important Notes

### Shared Backend (Production)
- Both laptops use the **same** Google Apps Script deployment
- Both laptops use the **same** Google Spreadsheet
- Changes to backend code affect production immediately
- Use separate development backend for testing changes

### Environment Variables
- Never commit `.env.local` or `.env` files
- Only `.env.example` is tracked in Git
- Each developer creates their own `.env.local`

### Git Workflow
```powershell
# Before starting work
git pull origin main

# Create feature branch
git checkout -b feature/your-feature

# Make changes, commit
git add .
git commit -m "feat: your feature description"

# Push and create PR
git push origin feature/your-feature
# Create PR on GitHub
```

### Secrets Management
- Google credentials: Never in Git
- Spreadsheet ID: In GAS Script Properties, not code
- PIN hashes: Only in Google Sheets (hashed)
- API keys: In environment variables only

## Troubleshooting

### "npm install" fails
- Delete `node_modules` and `package-lock.json`
- Run `npm cache clean --force`
- Try `npm install` again

### "Cannot find module" errors
- Run `npm install` in frontend directory
- Check `tsconfig.json` paths config

### GAS "Permission denied"
- Re-deploy Web App with "Anyone" access
- Check Script Properties has SPREADSHEET_ID
- Verify Sheets API enabled in GCP Console

### GPS not working on localhost
- Use `npm run dev` (serves on HTTP)
- Geolocation requires HTTPS
- For local testing, use Chrome flags:
  `--unsafely-treat-insecure-origin-as-secure=http://localhost:3000`

## Quick Commands Reference

```powershell
# Frontend
cd frontend
npm run dev          # Development server
npm run build        # Production build
npm run lint         # Lint check
npx tsc --noEmit     # Type check

# Git
git status           # Check changes
git pull             # Get latest
git add .            # Stage all
git commit -m "msg"  # Commit
git push             # Push to remote

# GAS (if using clasp)
clasp pull           # Download from GAS
clasp push           # Upload to GAS
clasp logs           # View logs
clasp open           # Open in browser
```