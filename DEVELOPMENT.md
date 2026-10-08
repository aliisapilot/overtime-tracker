# Development Guide

## Project Overview

Labour Attendance & Overtime Management System for Ateeb's UAE company. Mobile-first PWA for tracking labourer attendance with GPS verification and overtime calculation.

## Architecture

### Frontend (Next.js 14)
- **Pages Router** (not App Router) for static export compatibility
- **TypeScript** with strict mode
- **Tailwind CSS** for styling
- **Static Export** (`output: 'export'`) for Cloudflare Pages
- **API Routes** proxy requests to Google Apps Script

### Backend (Google Apps Script)
- **Web App** deployed with `doGet`/`doPost` handlers
- **Google Sheets** as database (6 sheets)
- **Services Pattern**: Modular service classes for each domain
- **Server-side validation** for all inputs

### Database (Google Sheets)
| Sheet | Purpose |
|-------|---------|
| Employees | Labourer records with PIN hashes |
| Job Sites | Work locations with GPS coordinates |
| Shifts | Attendance records with GPS validation |
| Overtime | Overtime records with approval workflow |
| Settings | Configurable system parameters |
| Audit Logs | Immutable action trail |

## Development Workflow

### Local Development

```bash
# Frontend
cd frontend
npm run dev          # Start dev server (port 3000)
npm run build        # Production build (static export)
npm run lint         # ESLint check
npm run typecheck    # TypeScript check (tsc --noEmit)
```

### Backend Development

1. Open Google Apps Script project at script.google.com
2. Edit files in the online editor
3. Test with `doPost` using the Test Deployment
4. View logs in Apps Script console

### Syncing Backend Changes

Since GAS doesn't support local development well:
1. Edit in Apps Script UI
2. Copy files back to `backend/` for version control
3. Or use `clasp` (Command Line Apps Script Projects) for sync

```bash
# Install clasp
npm install -g @google/clasp

# Login
clasp login

# Clone existing project
clasp clone SCRIPT_ID

# Pull changes
clasp pull

# Push changes
clasp push
```

## Code Conventions

### TypeScript (Frontend)
- Strict mode enabled
- No `any` types without justification
- Interfaces for all API responses
- Path aliases: `@/*` → `./src/*`

### JavaScript (Backend/GAS)
- ES6 classes with `module.exports`
- JSDoc comments for all public methods
- Error handling with try/catch
- Consistent return format: `{ success: boolean, ... }`

### Git Commits
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
- One logical change per commit
- Descriptive messages

## Adding New Features

### 1. New API Endpoint
1. Add handler in `backend/Code.gs` switch statement
2. Create service method in appropriate service
3. Add API route in `frontend/src/app/api/`
4. Update frontend to call new endpoint

### 2. New Database Field
1. Add column header in `SheetsService.initializeSheets()`
2. Update service methods to read/write new field
3. Update TypeScript interfaces in frontend
4. Run `init()` in GAS to add column

### 3. New Report
1. Add method in `AdminService.js`
2. Add case in `Code.gs` switch
3. Create frontend page/component
4. Add navigation

## Testing

### Frontend
```bash
# Type checking
npx tsc --noEmit

# Linting
npm run lint

# Build verification
npm run build
```

### Backend (Manual)
1. Use Apps Script Test Deployments
2. Test each action with sample JSON
3. Verify Sheets updates
4. Check Audit Logs sheet

## Common Tasks

### Reset Database (Development)
```javascript
// In Apps Script console
function resetDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ['Employees', 'Job Sites', 'Shifts', 'Overtime', 'Settings', 'Audit Logs'];
  sheets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) ss.deleteSheet(sheet);
  });
  init();
}
```

### Create Test Data
```javascript
// In Apps Script console
function createTestData() {
  const sheets = SheetsService;
  // Create test site
  const siteId = sheets.generateSiteId();
  sheets.appendRow(CONFIG.SHEETS.JOB_SITES, {
    ID: siteId, Name: 'Test Site', Address: 'Test Address',
    Latitude: 25.2533, Longitude: 55.3652,
    'Geofence Radius': 100, Status: 'Active',
    'Created At': new Date().toISOString()
  });
  
  // Create test employee
  const empId = sheets.generateEmployeeId();
  const auth = require('./services/AuthService');
  sheets.appendRow(CONFIG.SHEETS.EMPLOYEES, {
    ID: empId, Name: 'Test Employee', Phone: '+9665551234',
    Role: 'Labourer', 'Site ID': siteId,
    'PIN Hash': auth.hashPin('1234'), Status: 'Active',
    'Created At': new Date().toISOString()
  });
}
```

## Debugging

### Frontend
- Browser DevTools for React/Network
- `console.log` in development
- React DevTools extension

### Backend
- `Logger.log()` in Apps Script
- View → Execution transcript
- Stackdriver Logging (if enabled)

## Free Tier Limitations

| Service | Limit |
|---------|-------|
| Google Apps Script | 6 min/execution, 30 min/day |
| Google Sheets | 10M cells, 100k rows |
| Cloudflare Pages | 500 builds/month, 100GB bandwidth |
| GitHub Actions | 2000 min/month (private) |

## Troubleshooting

### Frontend build fails
- Check TypeScript errors: `npx tsc --noEmit`
- Verify all imports resolve
- Check for missing dependencies

### GAS deployment fails
- Check syntax (GAS uses V8 runtime)
- Verify all `require()` paths
- Check quota limits

### GPS not working
- Test on HTTPS (required for geolocation)
- Check browser permissions
- Verify GPS accuracy thresholds

## Next Development Priorities

1. Complete Labourer mobile UI (Start/End Shift buttons)
2. Implement GPS capture with retry logic
3. Build Admin dashboard with reports
4. Add Leaflet map for site visualization
5. PWA manifest and service worker
6. End-to-end testing