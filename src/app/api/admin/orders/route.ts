import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { cmykProfileName, cmykProfilePath } from '@/lib/colour';
import { aiExpandAvailable } from '@/lib/expand';
import { listOrders } from '@/lib/storage';
import { upscaylAvailable } from '@/lib/upscale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    orders: await listOrders(),
    // 管理画面の調整パネルで「何が使えるか」を出し分けるため
    capabilities: {
      upscayl: upscaylAvailable(),
      aiExpand: aiExpandAvailable(),
      cmykProfile: cmykProfileName(),
      cmykProfileFound: Boolean(cmykProfilePath()),
    },
  });
}
