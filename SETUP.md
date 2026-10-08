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

### Fast Deployment using Bundled Dist.gs (Recommended)

1. Open your Google Spreadsheet or create a blank spreadsheet at [sheets.google.com](https://sheets.google.com)
   - Name it: `Overtime Tracker Database`
2. In the Spreadsheet menu, click **Extensions** → **Apps Script**
   - This automatically creates a bound Apps Script project linked directly to your spreadsheet!
3. In the Apps Script code editor:
   - Clear whatever is inside `Code.gs`
   - Open [`backend/Dist.gs`](file:///c:/Users/user/Overtime%20Tracker/backend/Dist.gs) from this project
   - Copy the entire contents and paste into `Code.gs` in Apps Script
   - Click the Save icon (💾)
4. Initialize the Spreadsheet:
   - In the toolbar dropdown, select the function **`init`**
   - Click **Run**
   - Google will prompt for permissions ("Authorization required"): Click **Review Permissions** → select your Google account → Click **Advanced** → Click **Go to Untitled project (unsafe)** → Click **Allow**
   - Check the Execution log: `Spreadsheet initialized successfully`
   - Switch back to your Google Sheet: You will see all 6 tabs created (`Employees`, `Job Sites`, `Shifts`, `Overtime`, `Settings`, `Audit Logs`) with Ateeb seeded as Admin!
5. Deploy as Web App:
   - Click the blue **Deploy** button (top right) → **New deployment**
   - Select type: **Web app** (gear icon)
   - Description: `v1.2.0 Overtime API`
   - **Execute as**: **Me** (your Google email)
   - **Who has access**: **Anyone** *(Critical: allows your Next.js app to send attendance records)*
   - Click **Deploy**
   - Copy the **Web App URL** (e.g., `https://script.google.com/macros/s/.../exec`)
6. Configure Frontend:
   - Paste the Web App URL into [`frontend/.env.local`](file:///c:/Users/user/Overtime%20Tracker/frontend/.env.local):
     ```env
     NEXT_PUBLIC_GAS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_DEPLOYED_URL/exec
     ```

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