import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

// Mock data - will be replaced by real API in Phase 2
const mockData = {
  employees: [
    { id: 'EMP001', name: 'Ahmed Al Mansouri', phone: '+9665551234', role: 'Labourer', siteId: 'SITE001', pinHash: 'hashed_pin_001', status: 'Active' },
    { id: 'EMP002', name: 'Fatima Hassan', phone: '+9665555678', role: 'Labourer', siteId: 'SITE001', pinHash: 'hashed_pin_002', status: 'Active' },
    { id: 'EMP003', name: 'Khalid Abdullah', phone: '+9665559012', role: 'Labourer', siteId: 'SITE002', pinHash: 'hashed_pin_003', status: 'Active' },
  ],
  jobSites: [
    { id: 'SITE001', name: 'Dubai Industrial Park', address: 'Dubai, UAE', lat: 25.2533, lon: 55.3652, geofenceRadius: 100, status: 'Active' },
    { id: 'SITE002', name: 'Jabal Ali Free Zone', address: 'JAFZA, UAE', lat: 25.2500, lon: 55.3500, geofenceRadius: 100, status: 'Active' },
    { id: 'SITE003', name: 'Al Quoz Market Area', address: 'Al Quoz, Dubai, UAE', lat: 25.2600, lon: 55.3700, geofenceRadius: 80, status: 'Inactive' },
  ],
  shifts: [
    { id: 'SHIFT001', employeeId: 'EMP001', siteId: 'SITE001', startTime: '2026-10-08T08:00:00', endTime: '2026-10-08T17:00:00', startLat: 25.2533, startLon: 55.3652, startAccuracy: 22, endLat: 25.2550, endLon: 55.3680, endAccuracy: 21, breakMinutes: 60, regularHours: 8, overtimeHours: 0, status: 'Completed' },
    { id: 'SHIFT002', employeeId: 'EMP002', siteId: 'SITE001', startTime: '2026-10-08T09:00:00', endTime: '2026-10-08T16:00:00', startLat: 25.2533, startLon: 55.3652, startAccuracy: 19, endLat: 25.2570, endLon: 55.3720, endAccuracy: 23, breakMinutes: 45, regularHours: 7, overtimeHours: 1, status: 'Completed' },
  ],
  overtime: [
    { id: 'OT001', shiftId: 'SHIFT001', employeeId: 'EMP001', date: '2026-10-08', overtimeHours: 1, approvalStatus: 'Approved', approvedBy: 'Ateeb', approvedAt: '2026-10-08T18:00:00' },
  ],
  settings: {
    companyName: 'UAE Labour Management',
    timezone: 'Asia/Dubai',
    regularHours: 8,
    breakRules: '60 minutes',
    gpsAccuracyThreshold: 20,
    defaultGeofenceRadius: 100,
  },
  auditLogs: [
    { id: 'AL001', employeeId: 'EMP001', action: 'Login', timestamp: '2026-10-08T08:00:00Z', details: 'Successful login', performedBy: 'Ateeb' },
    { id: 'AL002', employeeId: 'EMP001', action: 'Start Shift', timestamp: '2026-10-08T08:00:00Z', details: 'Started shift at SITE001', performedBy: 'Ateeb' },
  ],
};

function IndexPage() {
  const router = useRouter();
  const [currentView, setCurrentView] = useState('employees');
  const [filteredEmployees, setFilteredEmployees] = useState(mockData.employees);

  // Filter employees by site
  const filteredBySite = (siteId: string) => filteredEmployees.filter(e => e.siteId === siteId);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <header className="bg-white shadow-sm rounded-lg p-4 mb-6">
        <h1 className="text-2xl font-bold text-center">Labour Attendance & Overtime Management</h1>
        <p className="text-gray-600 text-center">UAE Company - Mobile Friendly</p>
      </header>

      <main className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left panel - Employee list */}
        <section className="bg-white rounded-xl shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Labourers</h2>
          <div className="space-y-3">
            {filteredEmployees.map(emp => (
              <div key={emp.id} className="flex items-center justify-between p-3 border border-gray-200 rounded">
                <div>
                  <span className="font-medium">{emp.name}</span>
                  <span className="text-sm text-gray-500">ID: {emp.id}</span>
                </div>
                <span className="text-sm text-green-500">{emp.role}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Right panel - Job sites */}
        <section className="bg-white rounded-xl shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Job Sites</h2>
          <div className="space-y-3">
            {mockData.jobSites.map(site => (
              <div key={site.id} className="flex items-center justify-between p-3 border border-gray-200 rounded">
                <div>
                  <span className="font-medium">{site.name}</span>
                  <span className="text-sm text-gray-500">{site.address}</span>
                </div>
                <span className="text-sm text-blue-500">GPS: {site.lat}, {site.lon}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom panel - Shifts & Overtime */}
        <section className="bg-white rounded-xl shadow-md p-4">
          <h2 className="text-lg font-semibold mb-4">Shifts & Overtime</h2>
          <div className="space-y-3">
            {mockData.shifts.map(shift => (
              <div key={shift.id} className="flex items-center justify-between p-3 border border-gray-200 rounded">
                <div>
                  <span className="font-medium">{shift.employeeId}</span>
                  <span className="text-sm text-gray-500">{shift.siteId}</span>
                  <span className="text-sm text-gray-400">{shift.startTime}</span>
                </div>
                <span className="text-sm px-2 py-1 rounded bg-gray-100">{shift.status}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default IndexPage;