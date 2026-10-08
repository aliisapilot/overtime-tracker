# Labour Attendance & Overtime Management System

A mobile-first attendance and overtime tracking system for labour management, built with Next.js, Google Apps Script, and Google Sheets.

## Features

- **Employee Authentication**: Secure Employee ID + PIN login with hashed PINs
- **GPS Validation**: High-accuracy GPS with geofence verification (20m target, 30m max)
- **Shift Management**: Start/end shifts with automatic overtime calculation
- **Overtime Tracking**: Automatic overtime calculation with approval workflow
- **Admin Dashboard**: Manage employees, job sites, view attendance, generate reports
- **Audit Trail**: Complete audit logging for all actions
- **Mobile-First PWA**: Installable on mobile devices
- **Free Services Only**: Next.js, Google Apps Script, Google Sheets, Leaflet + OpenStreetMap

## Tech Stack

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Backend**: Google Apps Script (JavaScript)
- **Database**: Google Sheets
- **Maps**: Leaflet + OpenStreetMap (planned)
- **Hosting**: Cloudflare Pages (free tier)
- **Mobile**: PWA support

## Quick Start

### Prerequisites

- Node.js 18+ 
- Google Account (for Apps Script and Sheets)
- Git

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:3000`.

### Backend Setup (Google Apps Script)

1. Create a new Google Apps Script project at [script.google.com](https://script.google.com)
2. Copy all files from `backend/` to the Apps Script project
3. Create a new Google Spreadsheet
4. Link the Apps Script project to the Spreadsheet
5. Run the `init()` function to initialize sheets
6. Deploy as a Web App (Execute as: Me, Who has access: Anyone)
7. Copy the Web App URL

### Environment Configuration

Create `.env.local` in the frontend directory:

```env
NEXT_PUBLIC_GAS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

## Project Structure

```
Overtime Tracker/
├── frontend/                 # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   └── api/auth/     # API routes for GAS communication
│   │   ├── pages/            # Next.js pages
│   │   └── ...
│   ├── package.json
│   ├── tsconfig.json
│   └── ...
├── backend/                  # Google Apps Script backend
│   ├── Code.gs              # Main entry point
│   ├── lib/
│   │   └── Config.js        # Configuration constants
│   └── services/
│       ├── SheetsService.js  # Google Sheets operations
│       ├── AuthService.js    # Authentication
│       ├── LocationService.js # GPS & geofence
│       ├── ShiftService.js   # Shift management
│       ├── OvertimeService.js # Overtime approval
│       └── AdminService.js   # Admin operations
└── ...
```

## Google Sheets Schema

The system automatically creates these sheets:

- **Employees**: ID, Name, Phone, Role, Site ID, PIN Hash, Status, Created At, Last Accessed
- **Job Sites**: ID, Name, Address, Latitude, Longitude, Geofence Radius, Status, Created At
- **Shifts**: ID, Employee ID, Site ID, Start/End Time, GPS coords, Accuracy, Break Minutes, Regular/Overtime Hours, Status
- **Overtime**: ID, Shift ID, Employee ID, Date, Overtime Hours, Approval Status, Approved By/At
- **Settings**: Key, Value, Description, Updated At
- **Audit Logs**: ID, Employee ID, Action, Outcome, Timestamp, Performed By, Details

## GPS Requirements

- Target accuracy: ≤20 meters
- Maximum acceptable: ≤30 meters
- Retry attempts: 3
- Captured only at shift start/end
- Server-side timestamp validation
- Geofence validation against assigned site

## Overtime Calculation

- Regular hours: 8 hours/day (configurable)
- Break deduction: 60 minutes (configurable)
- Overtime = worked hours - regular hours - breaks
- Supports overnight shifts
- Requires admin approval

## Deployment

### Frontend (Cloudflare Pages)

1. Push to GitHub
2. Connect repository to Cloudflare Pages
3. Build command: `npm run build`
4. Output directory: `out`
5. Add environment variable: `NEXT_PUBLIC_GAS_WEB_APP_URL`

### Backend (Google Apps Script)

1. Deploy as Web App
2. Set execute as: "Me"
3. Set access: "Anyone"
4. Copy URL to frontend environment variable

## Security Notes

- PINs are hashed using SHA-256 before storage
- Never commit `.env` files or credentials
- Google Sheets access controlled by Apps Script permissions
- Audit logs track all sensitive operations
- HTTPS enforced in production

## License

Private - Internal use only