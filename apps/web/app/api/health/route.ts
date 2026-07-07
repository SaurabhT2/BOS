import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      version: process.env.npm_package_version ?? '1.0.0',
      timestamp: new Date().toISOString(),
      env: {
        hasSupabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
        hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      },
    },
    { status: 200 }
  );
}


