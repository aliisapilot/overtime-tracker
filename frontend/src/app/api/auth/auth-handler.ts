import { NextRequest, NextResponse } from 'next/server';

const GAS_WEB_APP_URL = process.env.NEXT_PUBLIC_GAS_WEB_APP_URL;

async function forwardToGAS(request: NextRequest, action: string, data: Record<string, unknown>): Promise<NextResponse> {
  if (!GAS_WEB_APP_URL) {
    return NextResponse.json(
      { success: false, error: 'Google Apps Script URL not configured' },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...data }),
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('GAS request failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend' },
      { status: 502 }
    );
  }
}

export async function doGet(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'getEmployeeData';
  const employeeId = searchParams.get('employeeId');

  return forwardToGAS(request, action, { employeeId });
}

export async function doPost(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  const { action, ...data } = body;

  if (!action) {
    return NextResponse.json(
      { success: false, error: 'Action is required' },
      { status: 400 }
    );
  }

  return forwardToGAS(request, action, data);
}